require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { parseActivities } = require('./parser');
const excelReader = require('./excel-reader');
const alphaSync = require('./alpha-knowledge-sync');
const seatalkBot = require('./seatalk-bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_ID_2 = process.env.GOOGLE_SHEET_ID_2;
const POLL_INTERVAL_RAW = parseInt(process.env.POLL_INTERVAL, 10);
const POLL_INTERVAL = Math.max(Number.isFinite(POLL_INTERVAL_RAW) ? POLL_INTERVAL_RAW : 30000, 30000);
const ACTIVITY_SNAPSHOT_PATH = path.join(__dirname, 'data', 'activity-snapshot.json');

// --------------- Google Sheets Auth (OAuth2) ---------------

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error(
    'Missing OAuth2 credentials. Make sure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
    'and GOOGLE_REFRESH_TOKEN are set in .env.\n' +
    'Run "node auth.js" to complete the authorization flow and obtain a refresh token.'
  );
  process.exit(1);
}

if (!SHEET_ID || SHEET_ID === 'your_google_sheet_id_here') {
  console.error(
    'Set GOOGLE_SHEET_ID in .env to your Google Sheet ID ' +
    '(the long string in the sheet URL).'
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

// --------------- Data Cache ---------------

let cachedData = null;
let cachedDataJson = null;
let cachedCalendarRows = null;
let cachedConfigRows = null;
let cachedActivitiesSnapshot = [];
let excelWatchTimer = null;

function loadActivitySnapshotFromDisk() {
  try {
    if (!fs.existsSync(ACTIVITY_SNAPSHOT_PATH)) return;
    const raw = fs.readFileSync(ACTIVITY_SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      cachedActivitiesSnapshot = parsed;
      console.log(`[cache] Loaded ${parsed.length} activities from snapshot`);
    }
  } catch (err) {
    console.error('[cache] Failed to load activity snapshot:', err.message);
  }
}

function saveActivitySnapshot(activities, reason) {
  if (!Array.isArray(activities) || activities.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(ACTIVITY_SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(ACTIVITY_SNAPSHOT_PATH, JSON.stringify(activities), 'utf8');
    cachedActivitiesSnapshot = activities;
    if (reason) console.log(`[cache] Activity snapshot updated (${activities.length}) by ${reason}`);
  } catch (err) {
    console.error('[cache] Failed to save activity snapshot:', err.message);
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
    console.error('Failed to fetch Sheet 2 data:', err.message);
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
      console.log(
        `[${new Date().toLocaleTimeString()}] Data changed – ` +
        `${data.sheetNames.length} sheet(s), ${totalRows} row(s) – ` +
        `pushing to ${io.engine.clientsCount} client(s)`
      );
      io.emit('sheet:update', cachedData);
      triggerAlphaSync();
    }
  } catch (err) {
    console.error('Polling error:', err.message);
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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (_req, res) => {
  res.json({ data: cachedData });
});

app.post('/api/seatalk-push', (req, res) => {
  if (req.headers['x-internal-key'] !== (process.env.SEATALK_SIGNING_SECRET || '')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  activitiesForSeaTalkPush()
    .then((activities) => seatalkBot.buildActivitySummary(activities))
    .then((summary) => seatalkBot.pushToGroup(summary, true))
    .then((resp) => {
      res.json({ ok: true, groupId: process.env.SEATALK_GROUP_ID, resp });
    })
    .catch((err) => {
      res.status(500).json({ error: err.message });
    });
});

// --------------- GitHub Webhook Auto-Deploy ---------------

app.post('/api/deploy', collectRawBody, (req, res) => {
  const secret = process.env.DEPLOY_SECRET;
  if (!secret) return res.status(500).json({ error: 'DEPLOY_SECRET not configured' });

  const sig = req.headers['x-hub-signature-256'] || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (sig !== expected) {
    console.error('[Deploy] Invalid signature');
    return res.status(403).json({ error: 'invalid signature' });
  }

  const event = req.headers['x-github-event'];
  if (event === 'ping') {
    console.log('[Deploy] GitHub ping received');
    return res.json({ ok: true, msg: 'pong' });
  }

  if (event !== 'push') {
    return res.json({ ok: true, msg: 'ignored event: ' + event });
  }

  console.log('[Deploy] Push event received, pulling and restarting...');
  res.json({ ok: true, msg: 'deploying' });

  try {
    const pullOut = execSync('git pull origin master', { cwd: __dirname, timeout: 30000 }).toString();
    console.log('[Deploy] git pull:', pullOut.trim());
    const npmOut = execSync('npm install --production', { cwd: __dirname, timeout: 60000 }).toString();
    console.log('[Deploy] npm install:', npmOut.trim().slice(-200));
    const pmOut = execSync('pm2 restart gng-activity-calendar', { timeout: 15000 }).toString();
    console.log('[Deploy] pm2 restart:', pmOut.trim().slice(-200));
  } catch (err) {
    console.error('[Deploy] Error:', err.message);
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

  return activities.map((a) => {
    let bestMatch = null;
    let bestScore = Infinity;

    for (const s of settings) {
      const sd = dayDiff(a.startDate, s.startDate);
      const ed = dayDiff(a.endDate, s.endDate);
      const hasNameHit = nameMatch(a.name, s.note, s.name);
      const nameBonus = hasNameHit ? -0.5 : 0;

      let score;

      if (hasNameHit) {
        if (sd <= 3 && ed <= 3) score = sd + ed;
        else if (sd <= 3 && ed <= 7) score = 5 + sd + ed;
        else if (sd <= 7 && ed <= 7) score = 15 + sd + ed;
        else if (sd <= 3 && ed <= 30) score = 30 + sd + ed;
        else if (sd <= 7 && ed <= 30) score = 50 + sd + ed;
        else if (sd <= 3 && ed === Infinity) score = 80 + sd;
        else if (sd === Infinity && ed === Infinity) score = 90;
        else continue;
      } else {
        if (sd + ed <= 2) score = 100 + sd + ed;
        else continue;
      }

      if (score < bestScore) {
        bestScore = score;
        bestMatch = s;
      }
    }

    if (bestMatch) {
      const matchedTypes = typeMap[bestMatch.eventId] || [];
      return {
        ...a,
        startDate: bestMatch.startDate || a.startDate,
        endDate: bestMatch.endDate || a.endDate,
        eventId: bestMatch.eventId,
        excelName: bestMatch.note || bestMatch.name,
        types:
          matchedTypes.length > 0
            ? matchedTypes
            : classifyUntyped(bestMatch.eventId, bestMatch.note, bestMatch.name, a.name, a.category),
      };
    }
    if (isWebActivity(a.name, a.category)) {
      return { ...a, eventId: null, excelName: null, types: ['网页活动'] };
    }
    return { ...a, eventId: null, excelName: null, types: ['未配置'] };
  });
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
  if (!cachedData) return cachedActivitiesSnapshot;
  let activities = parseActivities(cachedData, cachedCalendarRows, cachedConfigRows);
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
  const apiKey = process.env.ALPHA_KNOWLEDGE_API_KEY;
  if (!apiKey) return;
  try {
    const activities = buildTypedActivities();
    const expertId = process.env.ALPHA_KNOWLEDGE_EXPERT_ID || '7420';
    const citationURL = process.env.ALPHA_KNOWLEDGE_CITATION_URL || '';
    alphaSync.sync(activities, apiKey, expertId, citationURL);
  } catch (err) {
    console.error('[AlphaKnowledge] Trigger error:', err.message);
  }
}

function triggerUiRefreshAfterExcelReload(reason) {
  try {
    const typed = buildTypedActivities();
    saveActivitySnapshot(typed, 'excel-watch');
    io.emit('sheet:update', cachedData);
    triggerAlphaSync();
    console.log(
      `[excel-reader] Reload triggered by ${reason} – pushing update to ${io.engine.clientsCount} client(s)`
    );
  } catch (err) {
    console.error('[excel-reader] Post-reload refresh failed:', err.message);
  }
}

function setupExcelRealtimeWatch() {
  const excelPath = process.env.EVENT_EXCEL_PATH;
  if (!excelPath) {
    console.warn('[excel-reader] EVENT_EXCEL_PATH not configured, realtime watch disabled');
    return;
  }

  const watchIntervalMs = parseInt(process.env.EXCEL_WATCH_INTERVAL_MS, 10) || 2000;
  fs.watchFile(excelPath, { interval: watchIntervalMs }, (curr, prev) => {
    if (curr.mtimeMs === 0) return;
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;

    if (excelWatchTimer) clearTimeout(excelWatchTimer);
    excelWatchTimer = setTimeout(() => {
      excelReader.load(excelPath);
      triggerUiRefreshAfterExcelReload('local Event.xlsx change');
    }, 400);
  });

  console.log(`[excel-reader] Realtime watch enabled: ${excelPath} (interval ${watchIntervalMs}ms)`);
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
  console.log(`Server running at http://localhost:${PORT}`);

  loadActivitySnapshotFromDisk();
  excelReader.load(process.env.EVENT_EXCEL_PATH);
  setupExcelRealtimeWatch();
  // Fallback periodic reload in case host file watch misses events.
  setInterval(() => excelReader.load(), 10 * 60 * 1000);

  try {
    const [data, sheet2] = await Promise.all([fetchAllSheets(), fetchSheet2Data()]);
    cachedData = data;
    cachedDataJson = JSON.stringify(data);
    cachedCalendarRows = sheet2.calendarRows;
    cachedConfigRows = sheet2.configRows;
    saveActivitySnapshot(buildTypedActivities(), 'initial-load');
    const totalRows = Object.values(data.sheets).reduce((s, rows) => s + rows.length, 0);
    console.log(`Initial data loaded – ${data.sheetNames.length} sheet(s), ${totalRows} row(s)`);
    if (sheet2.calendarRows) console.log(`Calendar sheet loaded – ${sheet2.calendarRows.length} row(s)`);
    if (sheet2.configRows) console.log(`Config sheet loaded – ${sheet2.configRows.length} row(s)`);
  } catch (err) {
    console.error('Failed to load initial data:', err.message);
  }

  triggerAlphaSync();

  // Periodic re-sync (every 30 min) to keep "today" calculations fresh
  setInterval(triggerAlphaSync, 30 * 60 * 1000);

  // SeaTalk workday group push at 10:30 Beijing time (UTC+8)
  if (process.env.SEATALK_APP_ID) {
    seatalkBot.scheduleDailyPush(10, 30, activitiesForSeaTalkPush);
  }

  setInterval(poll, POLL_INTERVAL);
});
