'use strict';

const https = require('https');
const crypto = require('crypto');

const API_BASE = 'https://knowledge.alpha.insea.io/api';
const SYNC_TAG = 'GNG活动日历';
const KNOWLEDGE_FILENAME = 'gng-activities.md';

let cachedKnowledgeId = null;
let lastSyncHash = '';
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL = 5 * 60 * 1000; // 5 min cooldown

// --------------- HTTP helpers ---------------

function apiRequest(method, path, apiKey, body, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const headers = { Authorization: 'Bearer ' + apiKey };
    if (contentType) headers['Content-Type'] = contentType;
    if (body) headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(
      { hostname: url.hostname, port: 443, path: url.pathname, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let data;
          try { data = JSON.parse(raw); } catch { data = raw; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartUpload(path, apiKey, fields, file) {
  return new Promise((resolve, reject) => {
    const boundary = '----AKBoundary' + Date.now();

    let preamble = '';
    for (const [key, value] of Object.entries(fields)) {
      preamble += '--' + boundary + '\r\n';
      preamble += 'Content-Disposition: form-data; name="' + key + '"\r\n\r\n';
      preamble += value + '\r\n';
    }
    preamble += '--' + boundary + '\r\n';
    preamble +=
      'Content-Disposition: form-data; name="file"; filename="' +
      file.filename +
      '"\r\n';
    preamble += 'Content-Type: ' + file.contentType + '\r\n\r\n';

    const head = Buffer.from(preamble, 'utf8');
    const content = Buffer.from(file.content, 'utf8');
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
    const body = Buffer.concat([head, content, tail]);

    const url = new URL(API_BASE + path);
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let data;
          try { data = JSON.parse(raw); } catch { data = raw; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --------------- Markdown generation ---------------

const TYPE_LABELS = {
  EventTask: '任务活动',
  EventGacha: '抽奖活动',
  EventRedeem: '兑换活动',
  EventGachaBravo: '新抽奖',
  仅说明页活动: '仅说明页活动',
  网页活动: '网页活动',
  其他活动: '其他活动',
  未配置: '未配置',
};

function typeLabel(t) {
  return TYPE_LABELS[t] || t;
}

function generateMarkdown(activities) {
  const now = new Date(Date.now() + 8 * 3600000);
  const todayStr = now.toISOString().slice(0, 10);
  const timeStr = todayStr + ' ' + now.toISOString().slice(11, 19);

  const active = [];
  const upcoming = [];
  const all = [];

  for (const a of activities) {
    if (!a.startDate) continue;
    const end = a.endDate || a.startDate;
    const types = (a.types || []).map(typeLabel).join(', ') || '未配置';
    const entry = { name: a.name, start: a.startDate, end: a.endDate || '未知', types };

    if (a.startDate <= todayStr && end >= todayStr) {
      const left = Math.ceil((new Date(end + 'T00:00:00Z') - new Date(todayStr + 'T00:00:00Z')) / 86400000);
      entry.daysLeft = left;
      active.push(entry);
    } else if (a.startDate > todayStr) {
      const until = Math.ceil((new Date(a.startDate + 'T00:00:00Z') - new Date(todayStr + 'T00:00:00Z')) / 86400000);
      entry.daysUntil = until;
      if (until <= 14) upcoming.push(entry);
    }
    all.push(entry);
  }

  const lines = [];
  lines.push('# GNG 活动日历');
  lines.push('');
  lines.push('更新时间: ' + timeStr + ' (北京时间)');
  lines.push('今日: ' + todayStr);
  lines.push('');

  lines.push('## 正在进行 (' + active.length + '个)');
  lines.push('');
  if (active.length === 0) {
    lines.push('当前没有进行中的活动。');
  } else {
    for (const a of active) {
      lines.push('- ' + a.name + ' | ' + a.start + ' ~ ' + a.end + ' | 类型: ' + a.types + ' | 剩余' + a.daysLeft + '天');
    }
  }
  lines.push('');

  lines.push('## 即将开始 (' + upcoming.length + '个, 未来14天)');
  lines.push('');
  if (upcoming.length === 0) {
    lines.push('未来14天没有即将开始的活动。');
  } else {
    for (const a of upcoming) {
      lines.push('- ' + a.name + ' | ' + a.start + ' ~ ' + a.end + ' | 类型: ' + a.types + ' | ' + a.daysUntil + '天后开始');
    }
  }
  lines.push('');

  lines.push('## 全部活动 (' + all.length + '个)');
  lines.push('');
  for (const a of all) {
    lines.push('- ' + a.name + ' | ' + a.start + ' ~ ' + a.end + ' | 类型: ' + a.types);
  }
  lines.push('');

  return lines.join('\n');
}

// --------------- Sync logic ---------------

async function findExistingKnowledge(expertId, apiKey) {
  try {
    const res = await apiRequest(
      'GET',
      '/experts/' + expertId + '/knowledges',
      apiKey
    );
    if (res.status === 200 && res.data && res.data.knowledges) {
      const match = res.data.knowledges.find(
        (k) =>
          (k.tags && k.tags.includes(SYNC_TAG)) ||
          k.name === KNOWLEDGE_FILENAME
      );
      if (match) return match.id;
    }
  } catch (err) {
    console.error('[AlphaKnowledge] Failed to list knowledges:', err.message);
  }
  return null;
}

async function sync(activities, apiKey, expertId, citationURL) {
  if (!apiKey) return;

  const now = Date.now();
  if (now - lastSyncTime < MIN_SYNC_INTERVAL) return;

  const md = generateMarkdown(activities);
  const hash = crypto.createHash('md5').update(md).digest('hex');
  if (hash === lastSyncHash) return;

  if (!cachedKnowledgeId) {
    cachedKnowledgeId = await findExistingKnowledge(expertId, apiKey);
  }

  const fields = {
    tags: SYNC_TAG + ',自动同步',
    format: 'text/markdown',
  };
  if (citationURL) {
    fields.citationURL = citationURL;
    fields.citationTitle = 'GNG活动日历';
  }
  if (cachedKnowledgeId) {
    fields.knowledgeId = String(cachedKnowledgeId);
  }

  try {
    const res = await multipartUpload(
      '/experts/' + expertId + '/knowledges',
      apiKey,
      fields,
      {
        filename: KNOWLEDGE_FILENAME,
        contentType: 'text/markdown',
        content: md,
      }
    );

    if (res.status === 200 && res.data && res.data.id) {
      cachedKnowledgeId = res.data.id;
      lastSyncHash = hash;
      lastSyncTime = now;
      console.log(
        '[AlphaKnowledge] Synced (knowledge ID: ' + res.data.id + ', size: ' + md.length + ' bytes)'
      );
    } else if (
      res.status === 400 &&
      res.data &&
      res.data.reason === 'file duplicated'
    ) {
      lastSyncHash = hash;
      lastSyncTime = now;
      console.log('[AlphaKnowledge] Content unchanged, skipped.');
    } else {
      console.error(
        '[AlphaKnowledge] Sync failed:',
        res.status,
        JSON.stringify(res.data)
      );
    }
  } catch (err) {
    console.error('[AlphaKnowledge] Sync error:', err.message);
  }
}

module.exports = { sync, generateMarkdown };
