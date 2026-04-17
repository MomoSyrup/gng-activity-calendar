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
const { parseActivities } = require('./parser');
const { env, envWarnings } = require('./config/env');
const {
  applyManualDateCorrections,
  isExcludedActivityName,
} = require('./config/activity-rules');
const excelReader = require('./excel-reader');
const alphaSync = require('./alpha-knowledge-sync');
const seatalkBot = require('./seatalk-bot');
const logger = require('./lib/logger');
const packageInfo = require('./package.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = env.PORT;
const SHEET_ID = env.GOOGLE_SHEET_ID;
const SHEET_ID_2 = env.GOOGLE_SHEET_ID_2;
const POLL_INTERVAL = env.POLL_INTERVAL;
const ACTIVITY_SNAPSHOT_PATH = path.join(__dirname, 'data', 'activity-snapshot.json');
const EVENT_EXCEL_PATH = env.EVENT_EXCEL_PATH || path.join(__dirname, 'data', 'Event.xlsx');
const EVENT_UPLOAD_TMP_DIR = path.join(__dirname, 'data', 'uploads');

fs.mkdirSync(EVENT_UPLOAD_TMP_DIR, { recursive: true });

envWarnings.forEach((warning) => logger.warn('config_warning', { warning }));

// --------------- Google Sheets Auth (OAuth2) ---------------

const CLIENT_ID = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = env.GOOGLE_REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

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

let cachedData = null;
let cachedDataJson = null;
let cachedCalendarRows = null;
let cachedConfigRows = null;
let cachedActivitiesSnapshot = [];
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

function loadActivitySnapshotFromDisk() {
  try {
    if (!fs.existsSync(ACTIVITY_SNAPSHOT_PATH)) return;
    const raw = fs.readFileSync(ACTIVITY_SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      cachedActivitiesSnapshot = parsed;
      logger.info('activity_snapshot_loaded', { count: parsed.length });
    }
  } catch (err) {
    logger.error('activity_snapshot_load_failed', { error: err.message });
  }
}

function saveActivitySnapshot(activities, reason) {
  if (!Array.isArray(activities) || activities.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(ACTIVITY_SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(ACTIVITY_SNAPSHOT_PATH, JSON.stringify(activities), 'utf8');
    cachedActivitiesSnapshot = activities;
    runtimeState.lastSnapshotReason = reason || '';
    if (reason) {
      logger.info('activity_snapshot_updated', { count: activities.length, reason });
    }
  } catch (err) {
    logger.error('activity_snapshot_save_failed', { error: err.message });
  }
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

async function fetchAllSheets() {
  return fetchSpreadsheet(SHEET_ID);
}

async function fetchSheet2Data() {
  if (!SHEET_ID_2) return { calendarRows: null, configRows: null };
  try {
    const targets = ['1.0 event calendar', '活动配置'];
    const data = await fetchSpreadsheet(SHEET_ID_2, (n) => targets.includes(n));
    return {
      calendarRows: data.sheets['1.0 event calendar'] || null,
      configRows: data.sheets['活动配置'] || null,
    };
  } catch (err) {
    logger.error('sheet2_fetch_failed', { error: err.message });
    return { calendarRows: null, configRows: null };
  }
}

// --------------- Polling ---------------

async function poll() {
  try {
    const [data, sheet2] = await Promise.all([fetchAllSheets(), fetchSheet2Data()]);
    const json = JSON.stringify(data);

    // Keep last successful Sheet 2 snapshot when quota/network errors happen.
    if (sheet2.calendarRows) cachedCalendarRows = sheet2.calendarRows;
    if (sheet2.configRows) cachedConfigRows = sheet2.configRows;

    if (json !== cachedDataJson) {
      cachedData = data;
      cachedDataJson = json;
      const typedActivities = buildTypedActivities();
      saveActivitySnapshot(typedActivities, 'poll');
      const totalRows = Object.values(data.sheets).reduce((s, rows) => s + rows.length, 0);
      logger.info('sheet_poll_changed', {
        sheetCount: data.sheetNames.length,
        totalRows,
        clients: io.engine.clientsCount,
      });
      io.emit('sheet:update', cachedData);
      triggerAlphaSync();
    }
    runtimeState.lastPollSuccessAt = new Date().toISOString();
    runtimeState.lastPollError = '';
  } catch (err) {
    runtimeState.lastPollError = err.message;
    logger.error('sheet_poll_failed', { error: err.message });
  }
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

app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));

function buildHealthPayload() {
  return {
    status: 'ok',
    version: packageInfo.version,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: new Date(runtimeState.startedAt).toISOString(),
    pollIntervalMs: POLL_INTERVAL,
    snapshotActivities: cachedActivitiesSnapshot.length,
    cachedSheetCount: cachedData ? cachedData.sheetNames.length : 0,
    lastPollSuccessAt: runtimeState.lastPollSuccessAt,
    lastPollError: runtimeState.lastPollError || null,
    initialLoadComplete: runtimeState.initialLoadComplete,
  };
}

function isReady() {
  return runtimeState.initialLoadComplete || cachedActivitiesSnapshot.length > 0;
}

app.get('/healthz', (_req, res) => {
  res.json(buildHealthPayload());
});

app.get('/readyz', (_req, res) => {
  const payload = buildHealthPayload();
  payload.ready = isReady();
  res.status(payload.ready ? 200 : 503).json(payload);
});

app.get('/api/data', (_req, res) => {
  res.json({ data: cachedData });
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

function classifyUntyped(eventId, excelName, excelTxtName, gsName, gsCategory) {
  const overviewIds = excelReader.getOverviewIds();
  if (overviewIds.has(eventId)) return ['仅说明页活动'];
  if (isWebActivity(excelName, excelTxtName, gsName, gsCategory)) return ['网页活动'];
  return ['其他活动'];
}

function attachEventTypes(activities) {
  const settings = excelReader.getEventSettings();
  const typeMap = excelReader.getEventTypes();
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
              : classifyUntyped(s.eventId, s.note, s.name, a.name, a.category),
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
            : classifyUntyped(bestMatch.eventId, bestMatch.note, bestMatch.name, a.name, a.category),
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

function supplementWeekendSupply(activities) {
  const settings = excelReader.getEventSettings();
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

function buildTypedActivities() {
  if (!cachedData) {
    let fallback = Array.isArray(cachedActivitiesSnapshot) ? cachedActivitiesSnapshot : [];
    fallback = fallback.filter((a) => !isExcludedActivityName((a && a.name) || ''));
    fallback = applyManualDateCorrections(fallback);
    return fallback;
  }
  let activities = parseActivities(cachedData, cachedCalendarRows, cachedConfigRows);
  activities = activities.filter((a) => !isExcludedActivityName(a.name || ''));
  activities = applyManualDateCorrections(activities);
  activities = supplementWeekendSupply(activities);
  activities = attachEventTypes(activities);
  if (activities.length > 0) cachedActivitiesSnapshot = activities;
  return activities;
}

/** 与网页一致：先拉取最新 Sheets，再读同一套 /api/calendar JSON */
async function activitiesForSeaTalkPush() {
  await poll();
  const localBase = `http://127.0.0.1:${PORT}`;
  try {
    const acts = await seatalkBot.fetchCalendarActivities(localBase);
    if (acts && acts.length > 0) return acts;
  } catch (err) {
    console.warn('[SeaTalk] fetchCalendarActivities fallback:', err.message);
  }
  return buildTypedActivities();
}

function triggerAlphaSync() {
  const apiKey = env.ALPHA_KNOWLEDGE_API_KEY;
  if (!apiKey) return;
  try {
    const activities = buildTypedActivities();
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

function triggerUiRefreshAfterExcelReload(reason) {
  try {
    const typed = buildTypedActivities();
    saveActivitySnapshot(typed, reason || 'event-reload');
    io.emit('sheet:update', cachedData);
    triggerAlphaSync();
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

app.get('/api/calendar', (_req, res) => {
  try {
    const activities = buildTypedActivities();
    res.json({ activities });
  } catch (err) {
    console.error('Calendar parse error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/event-upload', upload.single('eventFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请先选择 Event.xlsx 文件' });

  const originalName = req.file.originalname || '';
  if (!isExcelFilename(originalName)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: '仅支持 .xlsx 文件' });
  }

  try {
    fs.mkdirSync(path.dirname(EVENT_EXCEL_PATH), { recursive: true });
    fs.renameSync(req.file.path, EVENT_EXCEL_PATH);
    excelReader.load(EVENT_EXCEL_PATH);
    triggerUiRefreshAfterExcelReload('manual Event.xlsx upload');
    const activities = buildTypedActivities();
    return res.json({
      ok: true,
      message: 'Event 表上传成功，活动数据已刷新',
      file: originalName,
      activities: activities.length,
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    console.error('[event-upload] Failed:', err.message);
    return res.status(500).json({ error: '上传失败：' + err.message });
  }
});

// --------------- WebSocket ---------------

io.on('connection', (socket) => {
  console.log(`Client connected  (id: ${socket.id})`);

  if (cachedData) {
    socket.emit('sheet:update', cachedData);
  }

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

  loadActivitySnapshotFromDisk();
  excelReader.load(EVENT_EXCEL_PATH);

  try {
    const [data, sheet2] = await Promise.all([fetchAllSheets(), fetchSheet2Data()]);
    cachedData = data;
    cachedDataJson = JSON.stringify(data);
    cachedCalendarRows = sheet2.calendarRows;
    cachedConfigRows = sheet2.configRows;
    saveActivitySnapshot(buildTypedActivities(), 'initial-load');
    const totalRows = Object.values(data.sheets).reduce((s, rows) => s + rows.length, 0);
    runtimeState.initialLoadComplete = true;
    runtimeState.lastPollSuccessAt = new Date().toISOString();
    runtimeState.lastPollError = '';
    logger.info('initial_data_loaded', {
      sheetCount: data.sheetNames.length,
      totalRows,
      calendarRows: sheet2.calendarRows ? sheet2.calendarRows.length : 0,
      configRows: sheet2.configRows ? sheet2.configRows.length : 0,
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
