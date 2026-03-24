'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const APP_ID = process.env.SEATALK_APP_ID;
const APP_SECRET = process.env.SEATALK_APP_SECRET;
const SIGNING_SECRET = process.env.SEATALK_SIGNING_SECRET;

let cachedToken = { accessToken: '', expireAt: 0 };

// ---------- Signature Verification ----------

function verifySignature(rawBody, signature) {
  if (!signature || !SIGNING_SECRET) return false;
  const hash = crypto
    .createHash('sha256')
    .update(Buffer.concat([rawBody, Buffer.from(SIGNING_SECRET)]))
    .digest('hex');
  return hash === signature;
}

// ---------- Access Token (with cache) ----------

function apiCall(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'openapi.seatalk.io',
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          reject(new Error('Failed to parse SeaTalk API response'));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function apiCallAuth(method, urlPath, body) {
  return getAccessToken().then((token) => {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const opts = {
        hostname: 'openapi.seatalk.io',
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
      };
      if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

      const req = https.request(opts, (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error('Failed to parse SeaTalk API response'));
          }
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  });
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.accessToken && cachedToken.expireAt > now + 60) {
    return cachedToken.accessToken;
  }

  console.log('[SeaTalk] Refreshing access token...');
  const resp = await apiCall('POST', '/auth/app_access_token', {
    app_id: APP_ID,
    app_secret: APP_SECRET,
  });

  if (resp.code !== 0) {
    console.error('[SeaTalk] Failed to get access token:', resp);
    throw new Error('SeaTalk auth failed, code=' + resp.code);
  }

  cachedToken = {
    accessToken: resp.app_access_token,
    expireAt: resp.expire,
  };
  console.log('[SeaTalk] Access token obtained, expires in', resp.expire - now, 's');
  return cachedToken.accessToken;
}

// ---------- Send Message (private chat) ----------

async function sendTextMessage(employeeCode, content, markdown) {
  const resp = await apiCallAuth('POST', '/messaging/v2/single_chat', {
    employee_code: employeeCode,
    message: {
      tag: 'text',
      text: { format: markdown ? 1 : 2, content },
    },
  });
  if (resp.code !== 0) {
    console.error('[SeaTalk] Send single message failed:', resp);
  }
  return resp;
}

// ---------- Send Message (group chat) ----------

async function sendGroupMessage(groupId, content, markdown) {
  const resp = await apiCallAuth('POST', '/messaging/v2/group_chat', {
    group_id: groupId,
    message: {
      tag: 'text',
      text: { format: markdown ? 1 : 2, content },
    },
  });
  if (resp.code !== 0) {
    console.error('[SeaTalk] Send group message failed:', resp);
  } else {
    console.log(`[SeaTalk] Group message sent to ${groupId}`);
  }
  return resp;
}

// ---------- Calendar API (same JSON as web /api/calendar) ----------

function fetchCalendarActivities(baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return Promise.reject(new Error('fetchCalendarActivities: empty baseUrl'));

  return new Promise((resolve, reject) => {
    const url = new URL(base + '/api/calendar');
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          resolve(Array.isArray(j.activities) ? j.activities : []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => {
      req.destroy();
      reject(new Error('fetchCalendarActivities timeout'));
    });
  });
}

// ---------- Build Activity Summary（与网页「今日进行中 / 即将开始」同一套规则与版式）----------

function parseYmdLocal(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const p = ymd.split('-').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}

function daysRemaining(todayStr, endStr) {
  const t = parseYmdLocal(todayStr);
  const e = parseYmdLocal(endStr);
  if (!t || !e) return null;
  t.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  return Math.round((e - t) / 86400000);
}

function activityMatchesWebActive(a, todayStr) {
  if (!a.startDate) return false;
  const end = a.endDate || a.startDate;
  if (!(a.startDate <= todayStr && end >= todayStr)) return false;
  if (!a.types || a.types.length === 0) return false;
  return !a.types.some((t) => t === '未配置');
}

function activityMatchesWebUpcoming(a, todayStr) {
  if (!a.startDate || a.startDate <= todayStr) return false;
  if (!a.types || a.types.length === 0) return false;
  return !a.types.some((t) => t === '未配置');
}

function activityLineTitle(a) {
  const n = (a.name || '').trim();
  const ex = (a.excelName || '').trim();
  if (!ex || ex === n) return n;
  if (ex.includes(n) || n.includes(ex.split('(')[0].trim())) return ex;
  return n;
}

function buildActivitySummary(activities, options) {
  const calendarBaseUrl = (options && options.calendarBaseUrl) || process.env.CALENDAR_PUBLIC_URL || 'http://101.133.141.32';

  if (!activities || activities.length === 0) return '当前暂无活动数据。';

  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  const active = activities.filter((a) => activityMatchesWebActive(a, today));
  active.sort((a, b) => (a.endDate || a.startDate || '').localeCompare(b.endDate || b.startDate || ''));

  const upcoming = activities.filter((a) => activityMatchesWebUpcoming(a, today));
  upcoming.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  const lines = ['**GNG 活动日历**', `🗓️ ${today}`, ''];

  if (active.length > 0) {
    lines.push(`🟢 正在进行 (${active.length})`);
    for (const a of active) {
      const type = a.types ? a.types[0] : '';
      const end = a.endDate || a.startDate || '?';
      const cat = (a.category && String(a.category).trim()) || '';
      const catPrefix = cat ? `【${cat}】` : '';
      const title = activityLineTitle(a);
      const rem = daysRemaining(today, end);
      const remStr = rem === null ? '?' : rem;
      lines.push(`• ${catPrefix}${title} [${type}] → ${end} (剩${remStr}天)`);
    }
  } else {
    lines.push('🟢 暂无正在进行的活动');
  }

  lines.push('');

  if (upcoming.length > 0) {
    const shown = upcoming.slice(0, 5);
    lines.push(`🔜 即将开始 (${upcoming.length})`);
    for (const a of shown) {
      const type = a.types ? a.types[0] : '';
      const title = activityLineTitle(a);
      lines.push(`• ${title} [${type}] ${a.startDate} 开始`);
    }
    if (upcoming.length > 5) lines.push(`...还有 ${upcoming.length - 5} 个`);
  }

  const linkBase = String(calendarBaseUrl).replace(/\/$/, '');
  lines.push('', `🔗 [查看完整日历](${linkBase})`);

  return lines.join('\n');
}

// ---------- Push to Group ----------

async function pushToGroup(content, markdown) {
  const groupId = process.env.SEATALK_GROUP_ID;
  if (!groupId) {
    console.log('[SeaTalk] No SEATALK_GROUP_ID configured, skip group push');
    return;
  }
  return sendGroupMessage(groupId, content, markdown);
}

// ---------- Daily Scheduler (Beijing time UTC+8) ----------

let dailyPushTimer = null;
let getActivitiesFn = null;

function getNowBeijing() {
  return new Date(Date.now() + 8 * 3600000);
}

function dateKeyInBeijing(beijingDate) {
  return beijingDate.toISOString().slice(0, 10);
}

function parseDateSet(envValue) {
  return new Set(
    String(envValue || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isWeekdayInBeijing(beijingDate) {
  const d = beijingDate.getUTCDay();
  return d >= 1 && d <= 5;
}

function isWorkdayPushDate(beijingDate, holidaySet, makeupWorkdaySet) {
  const key = dateKeyInBeijing(beijingDate);
  if (makeupWorkdaySet.has(key)) return true;
  if (holidaySet.has(key)) return false;
  return isWeekdayInBeijing(beijingDate);
}

function scheduleDailyPush(hour, minute, activityGetter) {
  getActivitiesFn = activityGetter;
  const holidaySet = parseDateSet(process.env.PUSH_HOLIDAYS);
  const makeupWorkdaySet = parseDateSet(process.env.PUSH_MAKEUP_WORKDAYS);

  function scheduleNext() {
    const nowBJ = getNowBeijing();
    const targetBJ = new Date(nowBJ);
    targetBJ.setUTCHours(hour, minute, 0, 0);
    if (targetBJ <= nowBJ) targetBJ.setUTCDate(targetBJ.getUTCDate() + 1);
    while (!isWorkdayPushDate(targetBJ, holidaySet, makeupWorkdaySet)) {
      targetBJ.setUTCDate(targetBJ.getUTCDate() + 1);
    }
    const delayMs = targetBJ - nowBJ;
    const hh = String(targetBJ.getUTCHours()).padStart(2, '0');
    const mm = String(targetBJ.getUTCMinutes()).padStart(2, '0');
    const dateStr = targetBJ.toISOString().slice(0, 10);
    console.log(`[SeaTalk] Next workday push: ${dateStr} ${hh}:${mm} Beijing time (in ${Math.round(delayMs / 60000)} min)`);
    dailyPushTimer = setTimeout(async () => {
      try {
        console.log('[SeaTalk] Running daily group push...');
        let activities = [];
        if (getActivitiesFn) {
          const r = getActivitiesFn();
          activities = r && typeof r.then === 'function' ? await r : r;
        }
        const summary = buildActivitySummary(activities);
        await pushToGroup(summary, true);
      } catch (err) {
        console.error('[SeaTalk] Daily push error:', err.message);
      }
      scheduleNext();
    }, delayMs);
  }

  scheduleNext();
}

// ---------- Exports ----------

module.exports = {
  verifySignature,
  getAccessToken,
  sendTextMessage,
  sendGroupMessage,
  fetchCalendarActivities,
  buildActivitySummary,
  pushToGroup,
  scheduleDailyPush,
};
