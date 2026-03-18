'use strict';

const crypto = require('crypto');
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

// ---------- Build Activity Summary ----------

function buildActivitySummary(activities) {
  if (!activities || activities.length === 0) return '当前暂无活动数据。';

  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  const active = activities.filter(
    (a) => a.startDate <= today && (!a.endDate || a.endDate >= today) && !(a.types && a.types[0] === '未配置')
  );
  const upcoming = activities.filter(
    (a) => a.startDate > today && !(a.types && a.types[0] === '未配置')
  );

  const lines = ['**GNG 活动日历**', `🗓 ${today}`, ''];

  if (active.length > 0) {
    lines.push(`🟢 **正在进行 (${active.length})**`);
    for (const a of active) {
      const type = a.types ? a.types[0] : '';
      const end = a.endDate || '?';
      const daysLeft = a.endDate
        ? Math.ceil((new Date(a.endDate) - new Date(today)) / 86400000)
        : '?';
      lines.push(`• ${a.name}  [${type}]  → ${end} (剩${daysLeft}天)`);
    }
  } else {
    lines.push('🟢 暂无正在进行的活动');
  }

  lines.push('');

  if (upcoming.length > 0) {
    const shown = upcoming.slice(0, 5);
    lines.push(`🔜 **即将开始 (${upcoming.length})**`);
    for (const a of shown) {
      const type = a.types ? a.types[0] : '';
      lines.push(`• ${a.name}  [${type}]  ${a.startDate} 开始`);
    }
    if (upcoming.length > 5) lines.push(`  …还有 ${upcoming.length - 5} 个`);
  }

  lines.push('', `🔗 [查看完整日历](http://47.84.103.80)`);

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

function scheduleDailyPush(hour, minute, activityGetter) {
  getActivitiesFn = activityGetter;

  function scheduleNext() {
    const nowBJ = getNowBeijing();
    const targetBJ = new Date(nowBJ);
    targetBJ.setUTCHours(hour, minute, 0, 0);
    if (targetBJ <= nowBJ) targetBJ.setUTCDate(targetBJ.getUTCDate() + 1);
    const delayMs = targetBJ - nowBJ;
    const hh = String(targetBJ.getUTCHours()).padStart(2, '0');
    const mm = String(targetBJ.getUTCMinutes()).padStart(2, '0');
    const dateStr = targetBJ.toISOString().slice(0, 10);
    console.log(`[SeaTalk] Next daily push: ${dateStr} ${hh}:${mm} Beijing time (in ${Math.round(delayMs / 60000)} min)`);
    dailyPushTimer = setTimeout(async () => {
      try {
        console.log('[SeaTalk] Running daily group push...');
        const activities = getActivitiesFn ? getActivitiesFn() : [];
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
  buildActivitySummary,
  pushToGroup,
  scheduleDailyPush,
};
