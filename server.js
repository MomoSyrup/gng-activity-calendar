require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { google } = require('googleapis');
const path = require('path');
const { parseActivities } = require('./parser');
const excelReader = require('./excel-reader');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_ID_2 = process.env.GOOGLE_SHEET_ID_2;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL, 10) || 5000;

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

    if (json !== cachedDataJson) {
      cachedData = data;
      cachedDataJson = json;
      cachedCalendarRows = sheet2.calendarRows;
      cachedConfigRows = sheet2.configRows;
      const totalRows = Object.values(data.sheets).reduce((s, rows) => s + rows.length, 0);
      console.log(
        `[${new Date().toLocaleTimeString()}] Data changed – ` +
        `${data.sheetNames.length} sheet(s), ${totalRows} row(s) – ` +
        `pushing to ${io.engine.clientsCount} client(s)`
      );
      io.emit('sheet:update', cachedData);
    }
  } catch (err) {
    console.error('Polling error:', err.message);
  }
}

// --------------- Static Files & REST API ---------------

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (_req, res) => {
  res.json({ data: cachedData });
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
        eventId: bestMatch.eventId,
        excelName: bestMatch.note || bestMatch.name,
        types: matchedTypes.length > 0 ? matchedTypes : ['其他活动'],
      };
    }
    return { ...a, eventId: null, excelName: null, types: ['未配置'] };
  });
}

app.get('/api/calendar', (_req, res) => {
  if (!cachedData) return res.json({ activities: [] });
  try {
    const activities = parseActivities(cachedData, cachedCalendarRows, cachedConfigRows);
    res.json({ activities: attachEventTypes(activities) });
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

  excelReader.load(process.env.EVENT_EXCEL_PATH);
  setInterval(() => excelReader.load(), 3600000);

  try {
    const [data, sheet2] = await Promise.all([fetchAllSheets(), fetchSheet2Data()]);
    cachedData = data;
    cachedDataJson = JSON.stringify(data);
    cachedCalendarRows = sheet2.calendarRows;
    cachedConfigRows = sheet2.configRows;
    const totalRows = Object.values(data.sheets).reduce((s, rows) => s + rows.length, 0);
    console.log(`Initial data loaded – ${data.sheetNames.length} sheet(s), ${totalRows} row(s)`);
    if (sheet2.calendarRows) console.log(`Calendar sheet loaded – ${sheet2.calendarRows.length} row(s)`);
    if (sheet2.configRows) console.log(`Config sheet loaded – ${sheet2.configRows.length} row(s)`);
  } catch (err) {
    console.error('Failed to load initial data:', err.message);
  }

  setInterval(poll, POLL_INTERVAL);
});
