const fs = require('fs');
const XLSX = require('xlsx');

const HEADER_ROWS = 5;

const TYPE_MAP = {
  EventTask: '任务活动',
  EventGacha: '抽奖活动',
  EventRedeem: '兑换活动',
  EventGachaBravo: '新抽奖',
};

let cachedSettings = [];
let cachedTypesByEventId = {};
let cachedOverviewIds = new Set();
let lastMtime = 0;
let filePath = null;

function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || serial < 1) return null;
  const utcDays = Math.floor(serial) - 25569;
  const d = new Date(utcDays * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseExcelFile(fpath) {
  if (!fpath || !fs.existsSync(fpath)) {
    console.warn(`[excel-reader] File not found: ${fpath || '(not configured)'}`);
    return { settings: [], typesByEventId: {} };
  }

  const wb = XLSX.readFile(fpath);

  const settings = [];
  const settingsSheet = wb.Sheets['EventSetting'];
  if (settingsSheet) {
    const rows = XLSX.utils.sheet_to_json(settingsSheet, { header: 1 });
    for (let i = HEADER_ROWS; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row[0] == null) continue;
      settings.push({
        eventId: row[0],
        name: String(row[1] || ''),
        note: String(row[2] || ''),
        startDate: excelSerialToDate(row[3]),
        endDate: excelSerialToDate(row[4]),
      });
    }
  }

  const typesByEventId = {};
  for (const [sheetName, label] of Object.entries(TYPE_MAP)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    for (let i = HEADER_ROWS; i < rows.length; i++) {
      const eid = rows[i] && rows[i][0];
      if (eid == null) continue;
      if (!typesByEventId[eid]) typesByEventId[eid] = [];
      if (!typesByEventId[eid].includes(label)) {
        typesByEventId[eid].push(label);
      }
    }
  }

  const overviewIds = new Set();
  const overviewSheet = wb.Sheets['EventOverview'];
  if (overviewSheet) {
    const rows = XLSX.utils.sheet_to_json(overviewSheet, { header: 1 });
    for (let i = HEADER_ROWS; i < rows.length; i++) {
      const eid = rows[i] && rows[i][0];
      if (eid != null) overviewIds.add(eid);
    }
  }

  return { settings, typesByEventId, overviewIds };
}

function load(fpath) {
  filePath = fpath || filePath;
  if (!filePath) return;

  try {
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs === lastMtime) return;
    lastMtime = stat.mtimeMs;
  } catch {
    return;
  }

  try {
    const result = parseExcelFile(filePath);
    cachedSettings = result.settings;
    cachedTypesByEventId = result.typesByEventId;
    cachedOverviewIds = result.overviewIds;
    console.log(
      `[excel-reader] Loaded ${cachedSettings.length} events, ` +
      `${Object.keys(cachedTypesByEventId).length} typed IDs, ` +
      `${cachedOverviewIds.size} overview IDs`
    );
  } catch (err) {
    console.error('[excel-reader] Parse error:', err.message);
  }
}

function getEventSettings() {
  return cachedSettings;
}

function getEventTypes() {
  return cachedTypesByEventId;
}

function getOverviewIds() {
  return cachedOverviewIds;
}

module.exports = { load, getEventSettings, getEventTypes, getOverviewIds };
