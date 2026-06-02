require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const multer = require('multer');
const parser = require('./parser');
const { parseActivities } = parser;
const { env, envWarnings } = require('./config/env');
const {
  applyManualDateCorrections,
  isExcludedActivityName,
} = require('./config/activity-rules');
const excelReader = require('./excel-reader');
const alphaSync = require('./alpha-knowledge-sync');
const seatalkBot = require('./seatalk-bot');
const appAuth = require('./lib/app-auth');
const userDirectoryLib = require('./lib/user-directory');
const logger = require('./lib/logger');
const packageInfo = require('./package.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = env.PORT;
const POLL_INTERVAL = env.POLL_INTERVAL;
const DATA_DIR = path.join(__dirname, 'data');
const EVENT_UPLOAD_TMP_DIR = path.join(__dirname, 'data', 'uploads');
const ENVIRONMENT_CONFIG_PATH = path.join(DATA_DIR, 'environment-config.json');
const USER_DIRECTORY_PATH = path.join(DATA_DIR, 'user-directory.json');
const GOOGLE_LOGIN_ENABLED = env.GOOGLE_LOGIN_ENABLED;
const GOOGLE_LOGIN_CLIENT_ID = env.GOOGLE_LOGIN_CLIENT_ID || env.GOOGLE_CLIENT_ID;
const GOOGLE_ALLOWED_EMAIL_DOMAINS = appAuth.normalizeAllowedEmailDomains(env.GOOGLE_LOGIN_ALLOWED_EMAIL_DOMAINS);
const APP_OWNER_EMAILS = userDirectoryLib.normalizeOwnerEmails(env.APP_OWNER_EMAILS);
const APP_SESSION_TTL_MS = env.APP_SESSION_TTL_HOURS * 60 * 60 * 1000;
const APP_SESSION_SECRET = env.APP_SESSION_SECRET;

const DEFAULT_ENVIRONMENT = 'rct';
const DEFAULT_CONFIG_CALENDAR_SHEET = '1.0 event calendar';
const DEFAULT_CONFIG_ACTIVITY_SHEET = '活动配置';
const ENVIRONMENT_DEFS = Object.freeze({
  dev: {
    key: 'dev',
    label: 'DEV',
    usesGoogleSheets: false,
    defaultEventExcelPath: 'D:\\P4\\Dev\\Excel\\Event.xlsx',
  },
  rct: {
    key: 'rct',
    label: 'RCT',
    usesGoogleSheets: true,
    defaultEventExcelPath: 'D:\\P4\\Branches\\RCT\\Excel\\Event.xlsx',
  },
});

fs.mkdirSync(EVENT_UPLOAD_TMP_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

envWarnings.forEach((warning) => logger.warn('config_warning', { warning }));

const userDirectory = userDirectoryLib.createUserDirectoryStore({
  filePath: USER_DIRECTORY_PATH,
  ownerEmails: APP_OWNER_EMAILS,
});

// --------------- Google Sheets Auth (OAuth2) ---------------

const CLIENT_ID = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = env.GOOGLE_REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const googleLoginClient = new google.auth.OAuth2(GOOGLE_LOGIN_CLIENT_ID);

const GOOGLE_API_PROXY = (env.GOOGLE_API_PROXY || '').replace(/\/+$/, '');
const GOOGLE_API_PROXY_KEY = env.GOOGLE_API_PROXY_KEY || '';

if (GOOGLE_API_PROXY) {
  logger.info('google_api_proxy_enabled', { proxy: GOOGLE_API_PROXY });

  // Override OAuth2 token endpoint
  oauth2Client.endpoints = {
    ...oauth2Client.endpoints,
    oauth2TokenUrl: `${GOOGLE_API_PROXY}/oauth2.googleapis.com/token`,
  };

  // Override gaxios _defaultAdapter to rewrite googleapis URLs before fetch
  try {
    const { Gaxios } = require('gaxios');
    const origDefaultAdapter = Gaxios.prototype._defaultAdapter;
    if (origDefaultAdapter) {
      Gaxios.prototype._defaultAdapter = async function (config) {
        if (config && config.url) {
          const urlStr = typeof config.url === 'string' ? config.url : config.url.toString();
          try {
            const u = new URL(urlStr);
            const needsProxy = u.hostname.endsWith('.googleapis.com');
            const isProxy = u.hostname === new URL(GOOGLE_API_PROXY).hostname;
            if (needsProxy || isProxy) {
              if (needsProxy) {
                config.url = `${GOOGLE_API_PROXY}/${u.hostname}${u.pathname}${u.search}`;
              }
              if (config.headers instanceof Headers || (config.headers && typeof config.headers.set === 'function')) {
                config.headers.set('X-Proxy-Key', GOOGLE_API_PROXY_KEY);
              } else if (config.headers && typeof config.headers === 'object') {
                config.headers['X-Proxy-Key'] = GOOGLE_API_PROXY_KEY;
              } else {
                config.headers = { 'X-Proxy-Key': GOOGLE_API_PROXY_KEY };
              }
            }
          } catch {}
        }
        return origDefaultAdapter.call(this, config);
      };
    }
  } catch {}
}

const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

// --------------- Data Cache ---------------

const environmentRuntimeConfig = loadEnvironmentRuntimeConfig();
const environmentStates = createEnvironmentStates();
const runtimeState = {
  startedAt: Date.now(),
  initialLoadComplete: false,
  lastPollSuccessAt: null,
  lastPollError: '',
  lastSnapshotReason: '',
};

const upload = multer({
  dest: EVENT_UPLOAD_TMP_DIR,
  limits: { fileSize: 15 * 1024 * 1024 },
});

function loadJsonFileSafe(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    logger.warn('json_file_load_failed', { filePath, error: error.message });
    return fallbackValue;
  }
}

function getEnvironmentDef(envKey) {
  return ENVIRONMENT_DEFS[envKey] || ENVIRONMENT_DEFS[DEFAULT_ENVIRONMENT];
}

function normalizeSheetIdList(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\n,\s]+/);

  return parts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function normalizeWorksheetList(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\n,，;；]+/);

  return parts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function normalizePrimarySheetSources(value) {
  const rows = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/\r?\n/);

  return rows
    .map((row) => {
      if (!row) return null;
      if (typeof row === 'object' && row.spreadsheetId) {
        const mode = String(row.mode || 'block').trim().toLowerCase() || 'block';
        if (row.worksheet) {
          return {
            spreadsheetId: String(row.spreadsheetId).trim(),
            worksheet: String(row.worksheet || '').trim(),
            mode,
          };
        }
        return normalizeWorksheetList(row.worksheets).map((worksheet) => ({
          spreadsheetId: String(row.spreadsheetId).trim(),
          worksheet,
          mode,
        }));
      }

      const raw = String(row).trim();
      if (!raw) return null;
      const [spreadsheetIdPart, worksheetPart, modePart] = raw.split('|');
      const spreadsheetId = String(spreadsheetIdPart || '').trim();
      if (!spreadsheetId) return null;
      const mode = String(modePart || 'block').trim().toLowerCase() || 'block';
      return normalizeWorksheetList(worksheetPart || '').map((worksheet) => ({
        spreadsheetId,
        worksheet,
        mode,
      }));
    })
    .flat()
    .filter((entry) => entry && entry.spreadsheetId && entry.worksheet)
    .filter((entry, index, list) => (
      list.findIndex((candidate) => (
        candidate.spreadsheetId === entry.spreadsheetId &&
        candidate.worksheet === entry.worksheet &&
        candidate.mode === entry.mode
      )) === index
    ));
}

function normalizeConfigSheetSource(value, legacySheetId) {
  if (value && typeof value === 'object') {
    return {
      spreadsheetId: String(value.spreadsheetId || '').trim(),
      calendarWorksheet: String(value.calendarWorksheet || DEFAULT_CONFIG_CALENDAR_SHEET).trim() || DEFAULT_CONFIG_CALENDAR_SHEET,
      configWorksheet: String(value.configWorksheet || DEFAULT_CONFIG_ACTIVITY_SHEET).trim() || DEFAULT_CONFIG_ACTIVITY_SHEET,
    };
  }

  const raw = String(value || legacySheetId || '').trim();
  if (!raw || raw === '[object Object]') {
    return {
      spreadsheetId: '',
      calendarWorksheet: DEFAULT_CONFIG_CALENDAR_SHEET,
      configWorksheet: DEFAULT_CONFIG_ACTIVITY_SHEET,
    };
  }

  const parts = raw.split('|');
  return {
    spreadsheetId: String(parts[0] || '').trim(),
    calendarWorksheet: String(parts[1] || DEFAULT_CONFIG_CALENDAR_SHEET).trim() || DEFAULT_CONFIG_CALENDAR_SHEET,
    configWorksheet: String(parts[2] || DEFAULT_CONFIG_ACTIVITY_SHEET).trim() || DEFAULT_CONFIG_ACTIVITY_SHEET,
  };
}

function loadEnvironmentRuntimeConfig() {
  const persisted = loadJsonFileSafe(ENVIRONMENT_CONFIG_PATH, {});
  const environments = persisted.environments || {};

  return {
    environments: {
      dev: {
        eventExcelOverridePath: environments.dev && environments.dev.eventExcelOverridePath
          ? String(environments.dev.eventExcelOverridePath)
          : '',
        primarySheetIds: [],
        configSheetId: '',
      },
      rct: {
        eventExcelOverridePath: environments.rct && environments.rct.eventExcelOverridePath
          ? String(environments.rct.eventExcelOverridePath)
          : '',
        includeConfigSource: environments.rct && typeof environments.rct.includeConfigSource === 'boolean'
          ? environments.rct.includeConfigSource
          : true,
        primarySheetSources: normalizePrimarySheetSources(
          environments.rct && environments.rct.primarySheetSources
            ? environments.rct.primarySheetSources
            : normalizeSheetIdList(
                environments.rct && environments.rct.primarySheetIds
                  ? environments.rct.primarySheetIds
                  : [env.GOOGLE_SHEET_ID].filter(Boolean)
              )
        ),
        configSource: normalizeConfigSheetSource(
          environments.rct && environments.rct.configSource,
          (environments.rct && environments.rct.configSheetId) || env.GOOGLE_SHEET_ID_2 || ''
        ),
      },
    },
  };
}

function saveEnvironmentRuntimeConfig() {
  fs.writeFileSync(
    ENVIRONMENT_CONFIG_PATH,
    JSON.stringify(environmentRuntimeConfig, null, 2),
    'utf8'
  );
}

function getEnvironmentRuntimeEntry(envKey) {
  const key = getEnvironmentDef(envKey).key;
  return environmentRuntimeConfig.environments[key];
}

function getEnvironmentSnapshotPath(envKey) {
  return path.join(DATA_DIR, `activity-snapshot-${envKey}.json`);
}

function getEnvironmentUploadPath(envKey) {
  return path.join(EVENT_UPLOAD_TMP_DIR, `${envKey}-Event.xlsx`);
}

function getEnvironmentEventExcelPath(envKey) {
  const entry = getEnvironmentRuntimeEntry(envKey);
  if (entry && entry.eventExcelOverridePath) {
    return entry.eventExcelOverridePath;
  }
  return getEnvironmentDef(envKey).defaultEventExcelPath;
}

function getEnvironmentPrimarySheetIds(envKey) {
  return getEnvironmentPrimarySheetSources(envKey)
    .map((entry) => entry.spreadsheetId)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function getEnvironmentPrimarySheetSources(envKey) {
  const entry = getEnvironmentRuntimeEntry(envKey);
  return entry ? normalizePrimarySheetSources(entry.primarySheetSources) : [];
}

function getEnvironmentConfigSheetId(envKey) {
  return getEnvironmentConfigSource(envKey).spreadsheetId;
}

function getEnvironmentConfigSource(envKey) {
  const entry = getEnvironmentRuntimeEntry(envKey);
  return entry
    ? normalizeConfigSheetSource(entry.configSource)
    : normalizeConfigSheetSource(null);
}

function shouldIncludeConfigSource(envKey) {
  const entry = getEnvironmentRuntimeEntry(envKey);
  return !!(entry && entry.includeConfigSource);
}

function buildEnvironmentView(envKey) {
  const envDef = getEnvironmentDef(envKey);
  const envState = getEnvironmentState(envKey);
  return {
    key: envDef.key,
    label: envDef.label,
    usesGoogleSheets: envDef.usesGoogleSheets,
    eventExcelPath: getEnvironmentEventExcelPath(envKey),
    eventExcelOverrideActive: !!getEnvironmentRuntimeEntry(envKey).eventExcelOverridePath,
    includeConfigSource: shouldIncludeConfigSource(envKey),
    primarySheetSources: getEnvironmentPrimarySheetSources(envKey),
    primarySheetIds: getEnvironmentPrimarySheetIds(envKey),
    configSource: getEnvironmentConfigSource(envKey),
    configSheetId: getEnvironmentConfigSheetId(envKey),
    lastReadSummary: envState ? envState.lastReadSummary : null,
  };
}

function createEnvironmentStates() {
  return Object.keys(ENVIRONMENT_DEFS).reduce((accumulator, envKey) => {
    accumulator[envKey] = {
      key: envKey,
      excelReader: excelReader.createReader(),
      cachedDataList: [],
      cachedDataListJson: '',
      cachedConfigRows: null,
      cachedCalendarRows: null,
      cachedActivitiesSnapshot: [],
      lastReadSummary: null,
    };
    return accumulator;
  }, {});
}

function getEnvironmentState(envKey) {
  return environmentStates[getEnvironmentDef(envKey).key];
}

function getRequestedEnvironmentKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ENVIRONMENT_DEFS[normalized] ? normalized : DEFAULT_ENVIRONMENT;
}

function shouldUseSecureCookies() {
  return /^https:\/\//i.test(env.CALENDAR_PUBLIC_URL || '');
}

function getCookieOptions(overrides) {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: shouldUseSecureCookies(),
    ...(overrides || {}),
  };
}

function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  const next = Array.isArray(current) ? current.concat(value) : [current, value];
  res.setHeader('Set-Cookie', next);
}

function setCookie(res, name, value, options) {
  appendSetCookie(res, appAuth.serializeCookie(name, value, getCookieOptions(options)));
}

function clearCookie(res, name) {
  appendSetCookie(
    res,
    appAuth.serializeCookie(
      name,
      '',
      getCookieOptions({
        maxAge: 0,
        expires: new Date(0),
      })
    )
  );
}

function getRequestCookies(req) {
  return appAuth.parseCookieHeader(req && req.headers ? req.headers.cookie : '');
}

function readSignedCookie(header, cookieName) {
  const cookies = appAuth.parseCookieHeader(header);
  const token = cookies[cookieName];
  const payload = appAuth.verifySignedToken(token, APP_SESSION_SECRET);
  if (!payload || appAuth.isExpired(payload)) return null;
  return payload;
}

function getAuthSession(req) {
  if (!GOOGLE_LOGIN_ENABLED) return null;
  return readSignedCookie(req && req.headers ? req.headers.cookie : '', appAuth.SESSION_COOKIE_NAME);
}

function sanitizeNextPath(value) {
  return appAuth.sanitizeNextPath(value);
}

function buildLogoutPath(nextPath) {
  return `/auth/logout?next=${encodeURIComponent(sanitizeNextPath(nextPath || '/'))}`;
}

function buildSessionView(session) {
  if (!session) return null;
  const resolvedUser = userDirectory.resolveSession(session);
  return {
    accountId: session.sub || session.accountId || '',
    name: session.name || '',
    email: session.email || '',
    picture: session.picture || '',
    provider: session.provider || 'google',
    hostedDomain: session.hostedDomain || '',
    expiresAt: session.expiresAt || '',
    role: resolvedUser ? resolvedUser.role : userDirectoryLib.ROLE_USER,
    permissions: resolvedUser ? resolvedUser.permissions : userDirectoryLib.permissionsForRole(userDirectoryLib.ROLE_USER),
    firstLoginAt: resolvedUser ? resolvedUser.firstLoginAt : '',
    lastLoginAt: resolvedUser ? resolvedUser.lastLoginAt : '',
    lastSeenAt: resolvedUser ? resolvedUser.lastSeenAt : '',
  };
}

function getNextPathFromRequest(req) {
  const headerNext = req && req.headers ? req.headers['x-next-path'] : '';
  if (typeof headerNext === 'string' && headerNext.trim()) {
    return sanitizeNextPath(headerNext);
  }

  const referer = req && typeof req.get === 'function' ? req.get('referer') : '';
  if (referer) {
    try {
      const parsed = new URL(referer);
      return sanitizeNextPath(`${parsed.pathname || '/'}${parsed.search || ''}`);
    } catch {}
  }

  return '/';
}

function getRequestEnvironmentKey(req) {
  const fromQuery = req && req.query ? req.query.env : '';
  const fromBody = req && req.body ? req.body.env : '';
  return getRequestedEnvironmentKey(fromQuery || fromBody || DEFAULT_ENVIRONMENT);
}

function requireAuthForApi(req, res, next) {
  if (!GOOGLE_LOGIN_ENABLED) return next();
  const session = getAuthSession(req);
  if (session) {
    req.authSession = session;
    req.authUser = userDirectory.resolveSession(session);
    return next();
  }

  res.status(401).json({
    error: 'authentication_required',
    message: '请先使用 Garena Google 邮箱登录',
  });
}

function requireDataManager(req, res, next) {
  const authUser = req.authUser || userDirectory.resolveSession(req.authSession);
  if (authUser && authUser.permissions && authUser.permissions.manageData) {
    req.authUser = authUser;
    return next();
  }

  return res.status(403).json({
    error: 'forbidden',
    message: 'Only admins or the owner can modify Event uploads and Google Sheet sources.',
  });
}

function requireUserManager(req, res, next) {
  const authUser = req.authUser || userDirectory.resolveSession(req.authSession);
  if (authUser && authUser.permissions && authUser.permissions.manageUsers) {
    req.authUser = authUser;
    return next();
  }

  return res.status(403).json({
    error: 'forbidden',
    message: 'Only admins or the owner can manage user roles.',
  });
}

function createAppSession(payload) {
  return {
    sub: payload.sub || '',
    name: payload.name || '',
    email: payload.email || '',
    picture: payload.picture || '',
    provider: 'google',
    hostedDomain: payload.hostedDomain || '',
    exp: Date.now() + APP_SESSION_TTL_MS,
    expiresAt: new Date(Date.now() + APP_SESSION_TTL_MS).toISOString(),
  };
}

function setAppSessionCookie(res, sessionPayload) {
  const token = appAuth.createSignedToken(sessionPayload, APP_SESSION_SECRET);
  setCookie(res, appAuth.SESSION_COOKIE_NAME, token, {
    maxAge: Math.floor(APP_SESSION_TTL_MS / 1000),
  });
}

async function verifyGoogleCredential(credential) {
  const ticket = await googleLoginClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_LOGIN_CLIENT_ID,
  });
  const payload = ticket.getPayload() || {};
  const email = String(payload.email || '').trim().toLowerCase();

  if (!payload.email_verified) {
    throw new Error('Google 账号邮箱还没有完成验证');
  }

  if (!appAuth.isAllowedGoogleEmail(email, GOOGLE_ALLOWED_EMAIL_DOMAINS)) {
    throw new Error('仅允许使用 @garena.com 和 @garena-external.com 邮箱登录');
  }

  return {
    sub: payload.sub || '',
    name: payload.name || email,
    email,
    picture: payload.picture || '',
    hostedDomain: payload.hd || '',
  };
}

function loadActivitySnapshotFromDisk(envKey) {
  const envState = getEnvironmentState(envKey);
  const snapshotPath = getEnvironmentSnapshotPath(envKey);
  try {
    if (!fs.existsSync(snapshotPath)) return;
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      envState.cachedActivitiesSnapshot = parsed;
      logger.info('activity_snapshot_loaded', { environment: envKey, count: parsed.length });
    }
  } catch (err) {
    logger.error('activity_snapshot_load_failed', { environment: envKey, error: err.message });
  }
}

function saveActivitySnapshot(envKey, activities, reason) {
  const envState = getEnvironmentState(envKey);
  const snapshotPath = getEnvironmentSnapshotPath(envKey);
  if (!Array.isArray(activities) || activities.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(activities), 'utf8');
    envState.cachedActivitiesSnapshot = activities;
    runtimeState.lastSnapshotReason = reason || '';
    if (reason) {
      logger.info('activity_snapshot_updated', { environment: envKey, count: activities.length, reason });
    }
  } catch (err) {
    logger.error('activity_snapshot_save_failed', { environment: envKey, error: err.message });
  }
}

function countSheetRows(sheetsMap) {
  return Object.values(sheetsMap || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

async function getSheetNames(spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  return meta.data.sheets.map((s) => s.properties.title);
}

async function fetchSpreadsheet(spreadsheetId, sheetFilter) {
  let sheetNames = await getSheetNames(spreadsheetId);
  if (sheetFilter) sheetNames = sheetNames.filter(sheetFilter);

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: sheetNames.map((name) => `'${name}'`),
  });

  const result = { sheetNames, sheets: {} };
  res.data.valueRanges.forEach((vr, i) => {
    result.sheets[sheetNames[i]] = vr.values || [];
  });
  return result;
}

async function fetchPrimarySheetsForEnvironment(envKey) {
  const envDef = getEnvironmentDef(envKey);
  if (!envDef.usesGoogleSheets) return [];

  const sheetIds = getEnvironmentPrimarySheetIds(envKey);
  if (sheetIds.length === 0) return [];

  return Promise.all(
    sheetIds.map(async (spreadsheetId) => ({
      spreadsheetId,
      data: await fetchSpreadsheet(spreadsheetId),
    }))
  );
}

async function fetchConfigSheetsForEnvironment(envKey) {
  const configSheetId = getEnvironmentConfigSheetId(envKey);
  if (!configSheetId) return { calendarRows: null, configRows: null };

  try {
    const targets = ['1.0 event calendar', '娲诲姩閰嶇疆'];
    const data = await fetchSpreadsheet(configSheetId, (name) => targets.includes(name));
    return {
      calendarRows: data.sheets['1.0 event calendar'] || null,
      configRows: data.sheets['娲诲姩閰嶇疆'] || null,
    };
  } catch (err) {
    logger.error('sheet2_fetch_failed', { environment: envKey, error: err.message });
    return { calendarRows: null, configRows: null };
  }
}

function normalizeWorksheetList(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n|[,;]+/);

  return parts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

async function fetchPrimarySheetsForEnvironment(envKey) {
  const envDef = getEnvironmentDef(envKey);
  if (!envDef.usesGoogleSheets) return [];

  const sources = getEnvironmentPrimarySheetSources(envKey);
  if (sources.length === 0) return [];

  const groupedSources = sources.reduce((accumulator, source) => {
    if (!accumulator[source.spreadsheetId]) accumulator[source.spreadsheetId] = [];
    accumulator[source.spreadsheetId].push(source);
    return accumulator;
  }, {});

  return Promise.all(
    Object.entries(groupedSources).map(async ([spreadsheetId, sourceEntries]) => ({
      spreadsheetId,
      sourceEntries,
      data: await fetchSpreadsheet(
        spreadsheetId,
        (name) => sourceEntries.some((entry) => entry.worksheet === name)
      ),
      sheetModes: sourceEntries.reduce((accumulator, entry) => {
        accumulator[entry.worksheet] = entry.mode || 'block';
        return accumulator;
      }, {}),
    }))
  );
}

async function fetchConfigSheetsForEnvironment(envKey) {
  const configSource = getEnvironmentConfigSource(envKey);
  if (!configSource.spreadsheetId) return { calendarRows: null, configRows: null };

  try {
    const targets = [configSource.calendarWorksheet, configSource.configWorksheet].filter(Boolean);
    const data = await fetchSpreadsheet(
      configSource.spreadsheetId,
      targets.length > 0 ? (name) => targets.includes(name) : null
    );
    return {
      calendarRows: data.sheets[configSource.calendarWorksheet] || null,
      configRows: data.sheets[configSource.configWorksheet] || null,
    };
  } catch (err) {
    logger.error('sheet2_fetch_failed', { environment: envKey, error: err.message });
    return { calendarRows: null, configRows: null };
  }
}

// --------------- Polling ---------------

async function pollEnvironment(envKey) {
  const envState = getEnvironmentState(envKey);
  const envDef = getEnvironmentDef(envKey);
  const includeConfigSource = shouldIncludeConfigSource(envKey);

  try {
    envState.excelReader.load(getEnvironmentEventExcelPath(envKey));
    envState.lastReadSummary = {
      environment: envKey,
      usesGoogleSheets: envDef.usesGoogleSheets,
      includeConfigSource,
      eventExcelPath: getEnvironmentEventExcelPath(envKey),
      eventSettingsCount: envState.excelReader.getEventSettings().length,
      primarySources: [],
      primaryRowCount: 0,
      configSource: null,
      configRowCount: 0,
      configCalendarRowCount: 0,
    };

    let nextDataList = [];
    if (envDef.usesGoogleSheets) {
      const [dataList, sheet2] = await Promise.all([
        fetchPrimarySheetsForEnvironment(envKey),
        includeConfigSource
          ? fetchConfigSheetsForEnvironment(envKey)
          : Promise.resolve({ calendarRows: null, configRows: null }),
      ]);

      nextDataList = dataList;
      envState.cachedCalendarRows = sheet2.calendarRows || null;
      envState.cachedConfigRows = sheet2.configRows || null;
      envState.lastReadSummary.primarySources = dataList.map((entry) => ({
        spreadsheetId: entry.spreadsheetId,
        requestedSheets: entry.sourceEntries || [],
        sheetNames: entry.data && Array.isArray(entry.data.sheetNames) ? entry.data.sheetNames : [],
        rowCount: countSheetRows(entry.data && entry.data.sheets),
      }));
      envState.lastReadSummary.primaryRowCount = envState.lastReadSummary.primarySources.reduce(
        (sum, entry) => sum + entry.rowCount,
        0
      );
      if (includeConfigSource) {
        const configSource = getEnvironmentConfigSource(envKey);
        envState.lastReadSummary.configSource = {
          spreadsheetId: configSource.spreadsheetId,
          calendarWorksheet: configSource.calendarWorksheet,
          configWorksheet: configSource.configWorksheet,
        };
        envState.lastReadSummary.configCalendarRowCount = Array.isArray(sheet2.calendarRows) ? sheet2.calendarRows.length : 0;
        envState.lastReadSummary.configRowCount = Array.isArray(sheet2.configRows) ? sheet2.configRows.length : 0;
      }
    } else {
      envState.cachedCalendarRows = null;
      envState.cachedConfigRows = null;
    }

    const previousDataJson = envState.cachedDataListJson;
    const previousActivitiesJson = JSON.stringify(envState.cachedActivitiesSnapshot || []);
    envState.cachedDataList = nextDataList;
    envState.cachedDataListJson = JSON.stringify(nextDataList);

    const typedActivities = buildTypedActivities(envKey);
    const nextActivitiesJson = JSON.stringify(typedActivities);

    if (envState.cachedDataListJson !== previousDataJson || nextActivitiesJson !== previousActivitiesJson) {
      saveActivitySnapshot(envKey, typedActivities, 'poll');
      const totalRows = nextDataList.reduce(
        (sum, entry) => sum + Object.values(entry.data.sheets).reduce((rowSum, rows) => rowSum + rows.length, 0),
        0
      );

      logger.info('sheet_poll_changed', {
        environment: envKey,
        spreadsheetCount: nextDataList.length,
        totalRows,
        clients: io.engine.clientsCount,
      });
      io.emit('sheet:update', { environment: envKey });
      if (envKey === 'rct') {
        triggerAlphaSync();
      }
    }

    runtimeState.lastPollSuccessAt = new Date().toISOString();
    runtimeState.lastPollError = '';
  } catch (err) {
    runtimeState.lastPollError = err.message;
    logger.error('sheet_poll_failed', { environment: envKey, error: err.message });
  }
}

async function poll() {
  await Promise.all(
    Object.keys(ENVIRONMENT_DEFS).map((envKey) => pollEnvironment(envKey))
  );
}

// --------------- SeaTalk Bot Callback ---------------

function collectRawBody(req, _res, next) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
}

app.post('/callback', collectRawBody, (req, res) => {
  const rawBody = req.rawBody;
  const signature = req.headers['signature'] || '';

  console.log(`[SeaTalk] Callback hit, body length=${rawBody.length}, sig=${signature ? 'present' : 'missing'}`);

  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    console.error('[SeaTalk] Failed to parse JSON body');
    return res.status(400).json({ error: 'invalid json' });
  }

  console.log(`[SeaTalk] Event: ${payload.event_type}`);

  if (!seatalkBot.verifySignature(rawBody, signature)) {
    console.error('[SeaTalk] Signature verification FAILED');
    return res.status(403).json({ error: 'invalid signature' });
  }

  switch (payload.event_type) {
    case 'event_verification':
      console.log(`[SeaTalk] Returning challenge: ${payload.event.seatalk_challenge}`);
      return res.json({ seatalk_challenge: payload.event.seatalk_challenge });

    case 'message_from_bot_subscriber': {
      const employeeCode = payload.event.employee_code;
      const userMsg = (payload.event.message && payload.event.message.text && payload.event.message.text.content) || '';
      console.log(`[SeaTalk] Message from ${employeeCode}: ${userMsg}`);

      activitiesForSeaTalkPush()
        .then((activities) => seatalkBot.buildActivitySummary(activities))
        .then((reply) => seatalkBot.sendTextMessage(employeeCode, reply, true))
        .catch((err) => console.error('[SeaTalk] Reply failed:', err.message));

      return res.json({ code: 0, message: 'ok' });
    }

    case 'bot_added_to_group_chat': {
      const groupId = payload.event.group && payload.event.group.group_id;
      const groupName = payload.event.group && payload.event.group.group_name;
      console.log(`[SeaTalk] ★ Bot added to group: ${groupName} (${groupId})`);
      return res.json({ code: 0, message: 'ok' });
    }

    default:
      console.log(`[SeaTalk] Unhandled event: ${payload.event_type}`);
      return res.json({ code: 0, message: 'ok' });
  }
});

// --------------- Static Files & REST API ---------------

function buildHealthPayload() {
  const snapshotCounts = Object.keys(environmentStates).reduce((accumulator, envKey) => {
    accumulator[envKey] = getEnvironmentState(envKey).cachedActivitiesSnapshot.length;
    return accumulator;
  }, {});
  const cachedSheetCounts = Object.keys(environmentStates).reduce((accumulator, envKey) => {
    accumulator[envKey] = getEnvironmentState(envKey).cachedDataList.length;
    return accumulator;
  }, {});

  return {
    status: 'ok',
    version: packageInfo.version,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: new Date(runtimeState.startedAt).toISOString(),
    pollIntervalMs: POLL_INTERVAL,
    snapshotActivities: snapshotCounts,
    cachedSheetCount: cachedSheetCounts,
    lastPollSuccessAt: runtimeState.lastPollSuccessAt,
    lastPollError: runtimeState.lastPollError || null,
    initialLoadComplete: runtimeState.initialLoadComplete,
  };
}

function isReady() {
  return runtimeState.initialLoadComplete || Object.keys(environmentStates).some(
    (envKey) => getEnvironmentState(envKey).cachedActivitiesSnapshot.length > 0
  );
}

app.get('/healthz', (_req, res) => {
  res.json(buildHealthPayload());
});

app.get('/readyz', (_req, res) => {
  const payload = buildHealthPayload();
  payload.ready = isReady();
  res.status(payload.ready ? 200 : 503).json(payload);
});

app.get('/api/auth/session', (req, res) => {
  const nextPath = sanitizeNextPath((req.query && req.query.next) || '/');
  const session = getAuthSession(req);
  const trackedUser = session ? userDirectory.recordSession(session, { markLogin: false }) : null;
  res.json({
    enabled: GOOGLE_LOGIN_ENABLED,
    authenticated: !!session,
    provider: 'google',
    clientId: GOOGLE_LOGIN_ENABLED ? GOOGLE_LOGIN_CLIENT_ID : '',
    allowedEmailDomains: GOOGLE_ALLOWED_EMAIL_DOMAINS,
    loginUrl: '',
    logoutUrl: GOOGLE_LOGIN_ENABLED ? buildLogoutPath(nextPath) : '',
    user: trackedUser ? { ...trackedUser, expiresAt: session.expiresAt || '' } : null,
  });
});

app.post('/api/auth/google', express.json({ limit: '256kb' }), async (req, res) => {
  if (!GOOGLE_LOGIN_ENABLED) {
    return res.status(404).json({ error: 'google_login_disabled' });
  }

  const credential = req.body && typeof req.body.credential === 'string'
    ? req.body.credential.trim()
    : '';

  if (!credential) {
    return res.status(400).json({ error: 'missing_google_credential' });
  }

  try {
    const identity = await verifyGoogleCredential(credential);
    const registeredUser = userDirectory.recordSession(identity, { markLogin: true });
    const sessionPayload = createAppSession(identity);
    setAppSessionCookie(res, sessionPayload);

    logger.info('google_login_success', {
      email: sessionPayload.email,
      hostedDomain: sessionPayload.hostedDomain,
    });

    return res.json({
      ok: true,
      enabled: true,
      authenticated: true,
      provider: 'google',
      clientId: GOOGLE_LOGIN_CLIENT_ID,
      allowedEmailDomains: GOOGLE_ALLOWED_EMAIL_DOMAINS,
      logoutUrl: buildLogoutPath(sanitizeNextPath((req.body && req.body.nextPath) || '/')),
      user: {
        ...registeredUser,
        expiresAt: sessionPayload.expiresAt || '',
      },
    });
  } catch (error) {
    logger.warn('google_login_rejected', { error: error.message });
    return res.status(401).json({
      error: 'google_login_rejected',
      message: error.message || 'Google 登录失败',
    });
  }
});

app.get('/auth/jira/start', (_req, res) => {
  return res.status(410).json({
    error: 'legacy_login_removed',
    message: '??????? Google ??????',
  });
});

app.get('/auth/jira/callback', (req, res) => {
  return res.redirect(sanitizeNextPath((req.query && req.query.next) || '/'));
});

app.get('/auth/logout', (req, res) => {
  clearCookie(res, appAuth.SESSION_COOKIE_NAME);
  res.redirect(sanitizeNextPath((req.query && req.query.next) || '/'));
});

app.post('/auth/logout', (req, res) => {
  clearCookie(res, appAuth.SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

const staticAssetOptions = {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
};

app.use('/shared', express.static(path.join(__dirname, 'shared'), staticAssetOptions));
app.use(express.static(path.join(__dirname, 'public'), staticAssetOptions));

app.get('/api/data', requireAuthForApi, (req, res) => {
  const envKey = getRequestEnvironmentKey(req);
  const envState = getEnvironmentState(envKey);
  res.json({
    environment: buildEnvironmentView(envKey),
    data: envState.cachedDataList,
  });
});

app.get('/api/environment-config', requireAuthForApi, (req, res) => {
  const envKey = getRequestEnvironmentKey(req);
  res.json({
    environment: buildEnvironmentView(envKey),
  });
});

app.get('/api/admin/users', requireAuthForApi, requireUserManager, (_req, res) => {
  res.json({
    users: userDirectory.listUsers(),
  });
});

app.patch('/api/admin/users/:accountId/role', requireAuthForApi, requireUserManager, express.json({ limit: '64kb' }), (req, res) => {
  try {
    const updatedUser = userDirectory.updateUserRole(
      req.authSession,
      req.params && req.params.accountId,
      req.body && req.body.role
    );
    res.json({
      ok: true,
      user: updatedUser,
      users: userDirectory.listUsers(),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.code || 'role_update_failed',
      message: error.message || 'Failed to update role',
    });
  }
});

app.post('/api/environment-config', requireAuthForApi, requireDataManager, express.json({ limit: '256kb' }), async (req, res) => {
  const envKey = getRequestEnvironmentKey(req);
  const envDef = getEnvironmentDef(envKey);

  if (!envDef.usesGoogleSheets) {
    return res.status(400).json({ error: 'google_sheet_config_not_supported_for_environment' });
  }

  const primarySheetSources = normalizePrimarySheetSources(req.body && req.body.primarySheetSources);
  const configSource = normalizeConfigSheetSource(req.body && req.body.configSource);
  const includeConfigSource = !(
    req.body &&
    Object.prototype.hasOwnProperty.call(req.body, 'includeConfigSource') &&
    !req.body.includeConfigSource
  );
  const runtimeEntry = getEnvironmentRuntimeEntry(envKey);
  runtimeEntry.primarySheetSources = primarySheetSources;
  runtimeEntry.configSource = configSource;
  runtimeEntry.includeConfigSource = includeConfigSource;
  saveEnvironmentRuntimeConfig();

  await pollEnvironment(envKey);

  res.json({
    ok: true,
    environment: buildEnvironmentView(envKey),
    activities: buildTypedActivities(envKey).length,
  });
});

app.post('/api/seatalk-push', (req, res) => {
  if (req.headers['x-internal-key'] !== (env.SEATALK_SIGNING_SECRET || '')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  activitiesForSeaTalkPush()
    .then((activities) => seatalkBot.buildActivitySummary(activities))
    .then((summary) => seatalkBot.pushToGroup(summary, true))
    .then((resp) => {
      res.json({ ok: true, groupId: env.SEATALK_GROUP_ID, resp });
    })
    .catch((err) => {
      res.status(500).json({ error: err.message });
    });
});

app.post('/api/seatalk-image-push', express.json(), async (req, res) => {
  if (req.headers['x-internal-key'] !== (env.SEATALK_SIGNING_SECRET || '')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const targetGroupId = (req.body && req.body.group_id) || env.SEATALK_GROUP_ID;
  if (!targetGroupId) {
    return res.status(400).json({ error: 'no group_id' });
  }
  try {
    await poll();
    const scriptPath = path.join(__dirname, 'scripts', 'send-group-calendar-image-push.js');
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, targetGroupId], {
      cwd: __dirname,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
      env: process.env,
      timeout: 120000,
    });
    if (stderr && stderr.trim()) console.warn('[image-push] stderr:', stderr.trim());
    res.json({ ok: true, groupId: targetGroupId, output: (stdout || '').trim() });
  } catch (err) {
    console.error('[image-push] Error:', err.message);
    res.status(500).json({ error: err.stderr || err.message });
  }
});

function dayDiff(d1, d2) {
  if (!d1 || !d2) return Infinity;
  const a = new Date(d1 + 'T00:00:00Z');
  const b = new Date(d2 + 'T00:00:00Z');
  return Math.abs(a - b) / 86400000;
}

const NAME_KEYWORDS = [
  ['石中剑', ['石中剑', 'sword']],
  ['石像鬼', ['石像鬼', 'monsterinva', '怪物', 'monster', 'invasion']],
  ['周末', ['周末', 'supply', 'weekend']],
  ['签到', ['签到', 'login', 'seasonal']],
  ['命运之轮', ['命运之轮']],
  ['99兑换', ['99兑换', '99store', '99商店']],
  ['荣耀', ['荣耀', 'career', 'glory']],
  ['巡逻', ['巡逻', 'patrol']],
  ['木头人', ['木头人', 'tung']],
  ['箱中', ['箱中', 'chest']],
  ['雪人', ['雪人', 'snowman']],
  ['哥布林', ['哥布林', 'goblin']],
  ['圣诞', ['圣诞', 'christmas']],
  ['线索', ['线索', 'clue']],
  ['海岛', ['海岛', 'cave', 'darkcave']],
  ['冲刺', ['冲刺', 'rush', 'sprint']],
  ['猎人', ['猎人', 'hunter', 'mercenary', 'bounty']],
  ['兑换', ['兑换', 'redeem']],
  ['抽奖', ['抽奖', 'gacha']],
  ['试炼', ['试炼', 'trial']],
  ['ramadan', ['ramadan', '斋月', '寻宝']],
  ['树', ['树', 'tree']],
];

function nameMatch(gsName, excelNote, excelTxtName) {
  const gs = (gsName || '').toLowerCase();
  const note = (excelNote || '').toLowerCase();
  const txt = (excelTxtName || '').toLowerCase();
  for (const [, patterns] of NAME_KEYWORDS) {
    const gsHas = patterns.some((p) => gs.includes(p));
    const excelHas = patterns.some((p) => note.includes(p) || txt.includes(p));
    if (gsHas && excelHas) return true;
  }
  return false;
}

function normalizeNameForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s_\-()（）【】\[\]{}:：/\\.,，。'"`~!@#$%^&*+|<>?]/g, '');
}

function isStrongSettingNameMatch(activityName, setting) {
  const a = normalizeNameForMatch(activityName);
  const note = normalizeNameForMatch(setting.note);
  const name = normalizeNameForMatch(setting.name);
  if (!a || a.length < 2) return false;
  return (
    (note && (a.includes(note) || note.includes(a))) ||
    (name && (a.includes(name) || name.includes(a)))
  );
}

function isWebActivity(...fields) {
  const combined = fields.map((s) => (s || '').toLowerCase()).join(' ');
  return combined.includes('h5') || combined.includes('网页');
}

function classifyUntyped(envState, eventId, excelName, excelTxtName, gsName, gsCategory) {
  const overviewIds = envState.excelReader.getOverviewIds();
  if (overviewIds.has(eventId)) return ['仅说明页活动'];
  if (isWebActivity(excelName, excelTxtName, gsName, gsCategory)) return ['网页活动'];
  return ['其他活动'];
}

function attachEventTypes(envState, activities) {
  const settings = envState.excelReader.getEventSettings();
  const typeMap = envState.excelReader.getEventTypes();
  if (settings.length === 0) return activities;
  const result = [];
  for (const a of activities) {
    let bestMatch = null;
    let bestScore = Infinity;

    for (const s of settings) {
      const sd = dayDiff(a.startDate, s.startDate);
      const ed = dayDiff(a.endDate, s.endDate);
      const hasNameHit =
        nameMatch(a.name, s.note, s.name) || isStrongSettingNameMatch(a.name, s);
      const nameBonus = hasNameHit ? -0.5 : 0;

      let score;

      // Strict rule: only allow Event binding when activity names match.
      // This avoids date-only false positives like unrelated activities
      // being attached to "周末补给".
      if (!hasNameHit) continue;

      if (sd <= 3 && ed <= 3) score = sd + ed;
      else if (sd <= 3 && ed <= 7) score = 5 + sd + ed;
      else if (sd <= 7 && ed <= 7) score = 15 + sd + ed;
      else if (sd <= 3 && ed <= 30) score = 30 + sd + ed;
      else if (sd <= 7 && ed <= 30) score = 50 + sd + ed;
      else if (sd <= 3 && ed === Infinity) score = 80 + sd;
      else if (sd === Infinity && ed === Infinity) score = 90;
      else continue;

      if (score < bestScore) {
        bestScore = score;
        bestMatch = s;
      }
    }

    // Expand into multiple phases when Event sheet contains multiple
    // strong periods for the same activity name.
    const periodMatches = settings
      .filter((s) => isStrongSettingNameMatch(a.name, s) && s.startDate && s.endDate)
      .sort((x, y) => (x.startDate || '').localeCompare(y.startDate || ''));
    if (periodMatches.length > 1) {
      for (const s of periodMatches) {
        const matchedTypes = typeMap[s.eventId] || [];
        result.push({
          ...a,
          startDate: s.startDate || a.startDate,
          endDate: s.endDate || a.endDate,
          eventId: s.eventId,
          excelName: s.note || s.name,
          types:
            matchedTypes.length > 0
              ? matchedTypes
              : classifyUntyped(envState, s.eventId, s.note, s.name, a.name, a.category),
        });
      }
      continue;
    }

    if (bestMatch) {
      const matchedTypes = typeMap[bestMatch.eventId] || [];
      result.push({
        ...a,
        startDate: bestMatch.startDate || a.startDate,
        endDate: bestMatch.endDate || a.endDate,
        eventId: bestMatch.eventId,
        excelName: bestMatch.note || bestMatch.name,
        types:
          matchedTypes.length > 0
            ? matchedTypes
            : classifyUntyped(envState, bestMatch.eventId, bestMatch.note, bestMatch.name, a.name, a.category),
      });
      continue;
    }
    if (isWebActivity(a.name, a.category)) {
      result.push({ ...a, eventId: null, excelName: null, types: ['网页活动'] });
      continue;
    }
    result.push({ ...a, eventId: null, excelName: null, types: ['未配置'] });
  }
  const dedup = [];
  const seen = new Set();
  for (const item of result) {
    const key = `${item.name || ''}|${item.startDate || ''}|${item.endDate || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
  }
  return dedup;
}

function supplementWeekendSupply(envState, activities) {
  const settings = envState.excelReader.getEventSettings();
  const weekendEntries = settings.filter((s) => {
    if (!s.note.includes('周末幸运补给') || !s.startDate || s.startDate < '2025-09-01') return false;
    if (!s.endDate) return false;
    const span = dayDiff(s.startDate, s.endDate);
    return span <= 7;
  });
  if (weekendEntries.length === 0) return activities;

  // Remove the maintenance-date placeholder (周末补给 with null endDate)
  activities = activities.filter(
    (a) => !(a.name === '周末补给' && !a.endDate)
  );

  const existing = activities.filter(
    (a) => a.name === '周末补给' || a.name.includes('周末补给')
  );

  for (const we of weekendEntries) {
    const alreadyCovered = existing.some(
      (a) => a.startDate && dayDiff(a.startDate, we.startDate) <= 2
    );
    if (!alreadyCovered) {
      activities.push({
        name: '周末补给',
        source: '1.0周末补给',
        startDate: we.startDate,
        endDate: we.endDate,
        rewards: [],
      });
    }
  }

  activities.sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9'));
  return activities;
}

function buildActivitiesFromExcelOnly(envState) {
  const settings = envState.excelReader.getEventSettings();
  const typeMap = envState.excelReader.getEventTypes();
  return settings.map((setting) => {
    const eventId = setting.eventId;
    const excelName = setting.note || setting.name || '';
    const matchedTypes = typeMap[eventId] || [];
    return {
      name: excelName || `Event ${eventId}`,
      source: 'EventSetting',
      category: 'Event.xlsx',
      startDate: setting.startDate || null,
      endDate: setting.endDate || setting.startDate || null,
      rewards: [],
      eventId,
      excelName,
      types: matchedTypes.length > 0
        ? matchedTypes
        : classifyUntyped(envState, eventId, setting.note, setting.name, excelName, 'Event.xlsx'),
    };
  });
}

function buildTypedActivities(envKey) {
  const envState = getEnvironmentState(envKey);
  const envDef = getEnvironmentDef(envKey);

  if (!envDef.usesGoogleSheets) {
    let activities = buildActivitiesFromExcelOnly(envState);
    activities = activities.filter((activity) => !isExcludedActivityName(activity.name || ''));
    activities = applyManualDateCorrections(activities);
    if (activities.length > 0) envState.cachedActivitiesSnapshot = activities;
    return activities;
  }

  if (!envState.cachedDataList || envState.cachedDataList.length === 0) {
    let fallback = Array.isArray(envState.cachedActivitiesSnapshot) ? envState.cachedActivitiesSnapshot : [];
    fallback = fallback.filter((activity) => !isExcludedActivityName((activity && activity.name) || ''));
    fallback = applyManualDateCorrections(fallback);
    return fallback;
  }

  let activities = [];
  envState.cachedDataList.forEach((entry) => {
    activities = activities.concat(
      parseActivities(entry.data, null, null, {
        sheetModes: entry.sheetModes || {},
      })
    );
  });

  if (shouldIncludeConfigSource(envKey)) {
    activities = parseActivities(
      { sheetNames: [], sheets: {} },
      envState.cachedCalendarRows,
      envState.cachedConfigRows,
      { baseActivities: activities }
    );
  }

  activities = activities.filter((activity) => !isExcludedActivityName(activity.name || ''));
  activities = applyManualDateCorrections(activities);
  activities = supplementWeekendSupply(envState, activities);
  activities = attachEventTypes(envState, activities);
  if (activities.length > 0) envState.cachedActivitiesSnapshot = activities;
  return activities;
}

/** 与网页一致：先拉取最新 Sheets，再读同一套 /api/calendar JSON */
async function activitiesForSeaTalkPush() {
  await poll();
  return buildTypedActivities('rct');
}

function triggerAlphaSync() {
  const apiKey = env.ALPHA_KNOWLEDGE_API_KEY;
  if (!apiKey) return;
  try {
    const activities = buildTypedActivities('rct');
    const expertId = env.ALPHA_KNOWLEDGE_EXPERT_ID || '7420';
    const citationURL = env.ALPHA_KNOWLEDGE_CITATION_URL || '';
    alphaSync.sync(activities, apiKey, expertId, citationURL);
  } catch (err) {
    console.error('[AlphaKnowledge] Trigger error:', err.message);
  }
}

async function pushDailyCalendarImageToGroup() {
  const groupId = env.SEATALK_GROUP_ID;
  if (!groupId) {
    throw new Error('SEATALK_GROUP_ID not configured');
  }
  const scriptPath = path.join(__dirname, 'scripts', 'send-group-calendar-image-push.js');
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { stdout } = await execFileAsync(process.execPath, [scriptPath, groupId], {
        cwd: __dirname,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 16,
        env: process.env,
        timeout: 120000,
      });
      logger.info('seatalk_daily_image_push_done', { output: (stdout || '').trim() });
      return;
    } catch (err) {
      const msg = err.stderr || err.stdout || err.message || '';
      const retriable = /ETIMEDOUT|ECONNRESET|socket hang up|timeout/i.test(msg);
      if (!retriable || attempt >= maxAttempts) {
        throw new Error(
          `daily image push failed (${err.code}): ${msg}`
        );
      }
      const delay = 5000 * attempt;
      console.warn(`[SeaTalk] Image push attempt ${attempt} failed (${msg.slice(0, 120)}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function triggerUiRefreshAfterExcelReload(envKey, reason) {
  try {
    const typed = buildTypedActivities(envKey);
    saveActivitySnapshot(envKey, typed, reason || 'event-reload');
    io.emit('sheet:update', { environment: envKey });
    if (envKey === 'rct') {
      triggerAlphaSync();
    }
    console.log(
      `[excel-reader] Reload triggered by ${reason} – pushing update to ${io.engine.clientsCount} client(s)`
    );
  } catch (err) {
    console.error('[excel-reader] Post-reload refresh failed:', err.message);
  }
}

function isExcelFilename(name) {
  return /\.xlsx$/i.test(String(name || ''));
}

app.get('/api/calendar', requireAuthForApi, (req, res) => {
  try {
    const envKey = getRequestEnvironmentKey(req);
    const activities = buildTypedActivities(envKey);
    res.json({
      environment: buildEnvironmentView(envKey),
      activities,
    });
  } catch (err) {
    console.error('Calendar parse error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/event-upload', requireAuthForApi, requireDataManager, upload.single('eventFile'), (req, res) => {
  const envKey = getRequestEnvironmentKey(req);
  const envState = getEnvironmentState(envKey);
  if (!req.file) return res.status(400).json({ error: '请先选择 Event.xlsx 文件' });

  const originalName = req.file.originalname || '';
  if (!isExcelFilename(originalName)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: '仅支持 .xlsx 文件' });
  }

  try {
    const uploadPath = getEnvironmentUploadPath(envKey);
    const runtimeEntry = getEnvironmentRuntimeEntry(envKey);
    fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
    fs.renameSync(req.file.path, uploadPath);
    runtimeEntry.eventExcelOverridePath = uploadPath;
    saveEnvironmentRuntimeConfig();
    envState.excelReader.load(uploadPath);
    triggerUiRefreshAfterExcelReload(envKey, 'manual Event.xlsx upload');
    const activities = buildTypedActivities(envKey);
    return res.json({
      ok: true,
      message: 'Event 表上传成功，活动数据已刷新',
      file: originalName,
      environment: envKey,
      activities: activities.length,
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    console.error('[event-upload] Failed:', err.message);
    return res.status(500).json({ error: '上传失败：' + err.message });
  }
});

// --------------- WebSocket ---------------

io.use((socket, next) => {
  if (!GOOGLE_LOGIN_ENABLED) return next();
  const session = readSignedCookie(
    socket && socket.request && socket.request.headers ? socket.request.headers.cookie || '' : '',
    appAuth.SESSION_COOKIE_NAME
  );
  if (!session) {
    return next(new Error('authentication_required'));
  }
  socket.request.authSession = session;
  return next();
});

io.on('connection', (socket) => {
  console.log(`Client connected  (id: ${socket.id})`);

  socket.emit('sheet:update', { environment: DEFAULT_ENVIRONMENT });

  socket.on('disconnect', () => {
    console.log(`Client disconnected (id: ${socket.id})`);
  });
});

// --------------- Start ---------------

server.listen(PORT, '0.0.0.0', async () => {
  logger.info('server_started', {
    port: PORT,
    version: packageInfo.version,
    node: process.version,
  });

  Object.keys(ENVIRONMENT_DEFS).forEach((envKey) => {
    loadActivitySnapshotFromDisk(envKey);
    getEnvironmentState(envKey).excelReader.load(getEnvironmentEventExcelPath(envKey));
  });

  try {
    await poll();
    runtimeState.initialLoadComplete = true;
    runtimeState.lastPollSuccessAt = new Date().toISOString();
    runtimeState.lastPollError = '';
    logger.info('initial_data_loaded', {
      environments: Object.keys(ENVIRONMENT_DEFS).map((envKey) => ({
        key: envKey,
        activities: getEnvironmentState(envKey).cachedActivitiesSnapshot.length,
        spreadsheets: getEnvironmentState(envKey).cachedDataList.length,
      })),
    });
  } catch (err) {
    runtimeState.lastPollError = err.message;
    logger.error('initial_data_load_failed', { error: err.message });
  }

  triggerAlphaSync();

  // Periodic re-sync (every 30 min) to keep "today" calculations fresh
  setInterval(triggerAlphaSync, 30 * 60 * 1000);

  // SeaTalk workday group push at 10:30 Beijing time (UTC+8)
  // >>> 暂停定时推送：当前无活动，待恢复时取消注释以下代码 <<<
  // if (env.SEATALK_APP_ID) {
  //   seatalkBot.scheduleDailyPush(
  //     10,
  //     30,
  //     activitiesForSeaTalkPush,
  //     async () => pushDailyCalendarImageToGroup()
  //   );
  // }

  setInterval(poll, POLL_INTERVAL);
});
