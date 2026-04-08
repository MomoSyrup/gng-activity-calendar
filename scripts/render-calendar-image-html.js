#!/usr/bin/env node
'use strict';

/**
 * Renders the GNG activity calendar as a high-quality PNG using Puppeteer.
 * Theme: Ancient Parchment — 古卷羊皮 / Elden Ring 气质
 * Usage: node render-calendar-image-html.js <out_path> [api_url] [web_url]
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');

const outPath = process.argv[2] || '/opt/gng-activity-calendar/public/generated/calendar-push-latest.png';
const apiUrl  = process.argv[3] || 'http://127.0.0.1:3000/api/calendar';
const webUrl  = (process.argv[4] || 'http://101.133.141.32').replace(/\/$/, '');

const BASE_DIR = path.join(__dirname, '..');

// ─── data helpers ─────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function bjNow() {
  const bj = new Date(Date.now() + 8 * 3600000);
  return { today: bj.toISOString().slice(0, 10), hour: bj.getUTCHours() };
}

function bjToday() {
  return bjNow().today;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayDiff(a, b) {
  return Math.round((parseDate(a) - parseDate(b)) / 86400000);
}

function activityKey(a) {
  return [a.name || '', a.startDate || '', a.endDate || '', a.source || '', a.category || ''].join('|');
}

function buildPeriodMap(acts) {
  const byName = {};
  for (const a of acts) {
    if (!a.name) continue;
    (byName[a.name] = byName[a.name] || []).push(a);
  }
  const out = {};
  for (const list of Object.values(byName)) {
    if (list.length <= 1) continue;
    list.sort((a, b) => (a.startDate || '9999') < (b.startDate || '9999') ? -1 : 1);
    list.forEach((a, i) => { out[activityKey(a)] = i + 1; });
  }
  return out;
}

function displayTitle(a, pm) {
  const p = pm[activityKey(a)];
  return p ? `${a.name}（第${p}期）` : (a.name || '');
}

function isValid(a) {
  return a.startDate && a.types && a.types.length && !a.types.includes('未配置');
}

function eventOnDay(a, dateStr) {
  return (a.startDate || '') <= dateStr && dateStr <= (a.endDate || a.startDate || '');
}

// ─── activity type → colour mapping ──────────────────────────
//   Keyed on the exact type strings returned by /api/calendar.
//   Priority order controls which type wins when multiple types are present.

const TYPE_PRIORITY = ['网页活动', '新抽奖', '抽奖活动', '兑换活动', '任务活动', '仅说明页活动'];

const TYPE_MAP = {
  '网页活动':    { border: '#9080c0', rowBg: 'rgba(18,10,30,0.72)', mark: '#9080c0', tag: '网页' },
  '新抽奖':      { border: '#50a8c8', rowBg: 'rgba(4,18,30,0.72)',  mark: '#50a8c8', tag: '抽奖' },
  '抽奖活动':    { border: '#50a8c8', rowBg: 'rgba(4,18,30,0.72)',  mark: '#50a8c8', tag: '抽奖' },
  '兑换活动':    { border: '#c9a84c', rowBg: 'rgba(30,18,3,0.72)',  mark: '#c9a84c', tag: '兑换' },
  '任务活动':    { border: '#7ab870', rowBg: 'rgba(6,22,8,0.70)',   mark: '#7ab870', tag: '任务' },
  '仅说明页活动':{ border: '#706050', rowBg: 'rgba(12,10,6,0.60)',  mark: '#706050', tag: '说明' },
};

const DEFAULT_STYLE = { border: '#a08848', rowBg: 'rgba(18,10,2,0.55)', mark: '#a08848', tag: '' };

function getTypeStyle(types) {
  if (!types || !types.length) return DEFAULT_STYLE;
  for (const key of TYPE_PRIORITY) {
    if (types.includes(key) && TYPE_MAP[key]) return TYPE_MAP[key];
  }
  return DEFAULT_STYLE;
}

function getAllTypeTags(types) {
  if (!types || !types.length) return [];
  const seen = new Set();
  const tags = [];
  for (const key of TYPE_PRIORITY) {
    if (types.includes(key) && TYPE_MAP[key] && TYPE_MAP[key].tag && !seen.has(TYPE_MAP[key].tag)) {
      seen.add(TYPE_MAP[key].tag);
      tags.push({ tag: TYPE_MAP[key].tag, color: TYPE_MAP[key].border });
    }
  }
  return tags;
}

// ─── badge helpers ────────────────────────────────────────────

// Activities reset at 04:00 BJ — an endDate=today activity has already
// closed at 4 AM, so past that hour we show "今日已关" instead of "今日结束".
function activeBadge(left, bjHour) {
  if (left === null) return '<span class="badge ok">进行中</span>';
  if (left === 0) {
    return (bjHour >= 4)
      ? '<span class="badge expired">今日已关</span>'
      : '<span class="badge urgent">今日结束</span>';
  }
  if (left <= 3)     return `<span class="badge urgent">余${left}日</span>`;
  if (left <= 7)     return `<span class="badge warn">余${left}日</span>`;
  return `<span class="badge ok">余${left}日</span>`;
}

function upcomingBadge(toStart) {
  if (toStart === null) return '<span class="badge purple">即将开启</span>';
  return `<span class="badge purple">${toStart}日后开启</span>`;
}

// ─── calendar grid (no event dots) ───────────────────────────

function calendarGrid(today) {
  const [y, m, d] = today.split('-').map(Number);
  const firstDay    = new Date(y, m - 1, 1).getDay();
  const mondayOff   = (firstDay + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();

  let rows = '', col = 0;
  let row  = '<div class="cal-row">';

  for (let i = 0; i < mondayOff; i++) {
    row += '<div class="cal-cell empty"></div>';
    if (++col === 7) { rows += row + '</div>'; row = '<div class="cal-row">'; col = 0; }
  }
  for (let dd = 1; dd <= daysInMonth; dd++) {
    const cls = dd === d ? 'cal-cell today' : 'cal-cell';
    row += `<div class="${cls}">${dd}</div>`;
    if (++col === 7) { rows += row + '</div>'; row = '<div class="cal-row">'; col = 0; }
  }
  if (col > 0) rows += row + '</div>';
  return rows;
}

// ─── HTML template (Ancient Parchment) ───────────────────────

function buildHtml(data, today, bgMapBase64, bgCharBase64, bjHour) {
  const acts = data.activities || [];
  const pm   = buildPeriodMap(acts);

  const active = acts
    .filter(a => isValid(a) && eventOnDay(a, today))
    .sort((a, b) => (a.endDate || '') < (b.endDate || '') ? -1 : 1);

  const upcoming = acts
    .filter(a => isValid(a) && (a.startDate || '') > today)
    .sort((a, b) => (a.startDate || '') < (b.startDate || '') ? -1 : 1)
    .slice(0, 8);

  const [y, m] = today.split('-').map(Number);
  const monthZh = `${y}年${m}月`;

  const bgStyle = bgMapBase64
    ? `background-image: url('data:image/png;base64,${bgMapBase64}'); background-size: cover; background-position: top center; background-color: #060402;`
    : 'background: #080604;';

  function actRow(a, isActive) {
    const s    = a.startDate || '';
    const e    = a.endDate || a.startDate || '';
    const ts   = getTypeStyle(a.types);
    const tags = getAllTypeTags(a.types);
    const badge = isActive
      ? activeBadge(e ? dayDiff(e, today) : null, bjHour)
      : upcomingBadge(s ? dayDiff(s, today) : null);
    const tagsHtml = tags.length > 0
      ? tags.map(t => `<span class="type-tag" style="color:${t.color};border-color:${t.color}50">${t.tag}</span>`).join('')
      : '<span class="type-tag" style="opacity:0;border-color:transparent">&nbsp;</span>';
    return `
    <div class="activity-row" style="background:${ts.rowBg};border-left:3px solid ${ts.border}50">
      <span class="row-mark" style="color:${ts.mark}">${isActive ? '❖' : '◈'}</span>
      <span class="act-name">${displayTitle(a, pm)}</span>
      <div class="type-tags">${tagsHtml}</div>
      <span class="act-date">${s} ~ ${e}</span>
      ${badge}
    </div>`;
  }

  const charHtml = bgCharBase64
    ? `<img class="bg-character" src="data:image/png;base64,${bgCharBase64}" alt="" />`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<style>
  @font-face {
    font-family: 'NotoSansSC';
    src: local('Noto Sans CJK SC'),
         url('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc') format('truetype');
    font-weight: 400;
  }
  @font-face {
    font-family: 'NotoSansSC';
    src: local('Noto Sans CJK SC Bold'),
         url('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc') format('truetype');
    font-weight: 700;
  }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'NotoSansSC', 'Microsoft YaHei', serif;
    width: 1200px;
    min-height: 760px;
    ${bgStyle}
    color: #d4b896;
    position: relative; overflow: hidden;
  }
  body::before {
    content: '';
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 100% 40% at 50% 0%,  rgba(40,26,6,0.32) 0%, transparent 55%),
      radial-gradient(ellipse 70% 50% at 0% 100%,  rgba(50,30,5,0.38) 0%, transparent 60%),
      radial-gradient(ellipse at center, transparent 20%, rgba(3,2,0,0.72) 100%),
      linear-gradient(160deg, rgba(10,7,2,0.58) 0%, rgba(5,3,1,0.50) 100%);
    z-index: 0; pointer-events: none;
  }

  .root {
    position: relative; z-index: 1;
    padding: 30px 38px 28px;
    display: flex; flex-direction: column; gap: 18px;
    overflow: hidden;
  }

  /* ── Title ───────────────────────────────── */
  .title-area {
    display: flex; align-items: center; justify-content: center;
  }
  .title-rule {
    flex: 1; height: 1px;
    background: linear-gradient(to right, transparent, rgba(180,140,60,0.28) 30%, rgba(200,160,70,0.60) 70%, transparent);
  }
  .title-rule.right {
    background: linear-gradient(to left, transparent, rgba(180,140,60,0.28) 30%, rgba(200,160,70,0.60) 70%, transparent);
  }
  .title-knot {
    font-size: 15px; color: rgba(200,160,70,0.75);
    margin: 0 16px; flex-shrink: 0; line-height: 1;
    filter: drop-shadow(0 0 5px rgba(200,160,70,0.45));
  }
  h1 {
    font-size: 40px; font-weight: 700; letter-spacing: 8px;
    color: transparent;
    background: linear-gradient(180deg, #f0dfa0 0%, #c9a84c 38%, #8b6a1a 72%, #c9a84c 100%);
    -webkit-background-clip: text; background-clip: text;
    filter: drop-shadow(0 2px 10px rgba(180,130,30,0.45));
    flex-shrink: 0; padding: 0 20px;
  }

  /* ── Today row — 4-column even grid ─────── */
  .today-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1.3fr;
    background: linear-gradient(135deg, rgba(18,11,3,0.92), rgba(10,6,1,0.96));
    border: 1px solid rgba(180,140,50,0.38);
    border-radius: 3px;
    overflow: hidden;
    box-shadow: 0 0 18px rgba(140,100,20,0.12), inset 0 1px 0 rgba(200,160,70,0.08);
    position: relative;
  }
  .today-row::before {
    content: '';
    position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: linear-gradient(to bottom, #c9a84c, #8b6a1a, #c9a84c);
  }
  /* Each cell in the grid — compact single row */
  .today-cell {
    display: flex; flex-direction: row; align-items: center; justify-content: center;
    padding: 9px 16px;
    border-left: 1px solid rgba(140,100,30,0.24);
    gap: 7px;
  }
  .today-cell:first-child {
    border-left: none;
    padding-left: 22px;
    justify-content: flex-start;
  }
  .today-label {
    font-size: 10px; font-weight: 700; letter-spacing: 3px;
    color: rgba(180,140,50,0.65); text-transform: uppercase;
  }
  .today-date {
    font-size: 16px; font-weight: 700; letter-spacing: 2px;
    color: #d4b896;
  }
  .today-gem { font-size: 9px; color: rgba(180,140,50,0.50); }
  .cell-icon { font-size: 15px; line-height: 1; flex-shrink: 0; }
  .cell-num {
    font-size: 20px; font-weight: 700; color: #c9a84c; line-height: 1;
  }
  .cell-label {
    font-size: 12px; color: rgba(160,130,70,0.52); letter-spacing: 1px;
    white-space: nowrap;
  }
  .cell-reset {
    font-size: 12px; color: rgba(140,110,60,0.45); font-style: italic;
    white-space: nowrap; letter-spacing: 0.5px;
  }

  /* ── Layout ──────────────────────────────── */
  .main-layout { display: flex; gap: 20px; align-items: flex-start; }

  /* ── Calendar ────────────────────────────── */
  .cal-panel {
    width: 244px; flex-shrink: 0;
    background: rgba(10,6,2,0.88);
    border: 1px solid rgba(140,100,30,0.32);
    border-radius: 3px;
    padding: 18px 14px;
    position: relative;
  }
  .cal-panel::before { content: '❧'; position: absolute; top: 7px; left: 9px; font-size: 14px; color: rgba(180,140,50,0.40); }
  .cal-panel::after  { content: '❧'; position: absolute; bottom: 7px; right: 9px; font-size: 14px; color: rgba(180,140,50,0.40); transform: scale(-1); }
  .corner-rt { position: absolute; top: 7px; right: 9px; font-size: 14px; color: rgba(180,140,50,0.40); transform: scaleX(-1); }
  .corner-lb { position: absolute; bottom: 7px; left: 9px; font-size: 14px; color: rgba(180,140,50,0.40); transform: scaleY(-1); }

  .cal-month {
    text-align: center; font-size: 17px; font-weight: 700;
    color: #c9a84c; margin-bottom: 10px; letter-spacing: 3px;
    text-shadow: 0 0 10px rgba(180,130,30,0.32);
  }
  .cal-divider { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
  .cal-div-line { flex: 1; height: 1px; background: linear-gradient(to right, transparent, rgba(160,120,40,0.38), transparent); }
  .cal-div-gem  { color: rgba(180,140,50,0.55); font-size: 8px; }

  .cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 6px; }
  .cal-wd { text-align: center; font-size: 11px; color: rgba(180,140,70,0.45); padding: 3px 0; }
  .cal-wd:nth-child(6), .cal-wd:nth-child(7) { color: rgba(160,90,60,0.58); }

  .cal-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 2px; }
  .cal-cell {
    aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    font-size: 12px; color: rgba(180,150,100,0.52);
    border-radius: 2px;
  }
  .cal-cell.empty { }
  .cal-cell.today {
    background: linear-gradient(135deg, rgba(110,65,8,0.80), rgba(65,35,3,0.90));
    border: 1px solid rgba(200,160,55,0.80);
    color: #f0d890; font-weight: 700;
    box-shadow: 0 0 10px rgba(160,110,20,0.50), inset 0 0 6px rgba(180,140,50,0.14);
  }

  /* ── Right panels ────────────────────────── */
  .panels { flex: 1; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .panel {
    background: rgba(8,5,1,0.88);
    border: 1px solid rgba(140,100,30,0.26);
    border-radius: 3px;
    padding: 18px 22px;
    position: relative; overflow: hidden;
  }
  .panel::before {
    content: ''; position: absolute; top: 0; left: 50px; right: 50px; height: 1px;
    background: linear-gradient(to right, transparent, rgba(180,140,50,0.42), transparent);
  }
  .panel.active-panel   { border-left: 2px solid rgba(180,100,30,0.55); }
  .panel.upcoming-panel { border-left: 2px solid rgba(80,60,130,0.55); }

  /* Section header */
  .section-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
  .section-rune   { font-size: 17px; flex-shrink: 0; }
  .section-title  { font-size: 20px; font-weight: 700; letter-spacing: 3px; }
  .section-title.active   { color: #c9a84c; text-shadow: 0 0 12px rgba(180,130,30,0.38); }
  .section-title.upcoming { color: #9a84c0; text-shadow: 0 0 12px rgba(120,90,180,0.32); }
  .section-sub { font-size: 12px; color: rgba(150,120,60,0.5); font-style: italic; margin-left: auto; letter-spacing: 0.5px; }

  /* Activity rows — grid layout keeps all columns aligned across rows */
  .activity-row {
    display: grid;
    /* mark | name | type-tags | date | badge */
    grid-template-columns: 18px 1fr auto 163px 76px;
    align-items: center;
    column-gap: 7px;
    padding: 9px 14px 9px 10px;
    border-radius: 2px;
    border: 1px solid rgba(140,100,30,0.11);
    /* border-left is set inline per type */
    margin-bottom: 8px;
  }
  .activity-row:last-child { margin-bottom: 0; }
  .row-mark { font-size: 10px; line-height: 1; text-align: center; }
  .act-name {
    font-size: 15px; font-weight: 500; color: #d4b896;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .type-tags {
    display: flex; gap: 4px; align-items: center;
    min-width: 46px; justify-content: flex-end;
  }
  .type-tag {
    font-size: 11px; font-weight: 700; letter-spacing: 1px;
    padding: 2px 5px; border-radius: 2px; border: 1px solid;
    white-space: nowrap; background: rgba(0,0,0,0.30);
    text-align: center;
  }
  .act-date {
    font-size: 12px; color: rgba(160,120,60,0.52);
    white-space: nowrap; text-align: left;
    font-style: italic;
  }
  .badge {
    font-size: 12px; font-weight: 700;
    padding: 3px 0; border-radius: 2px;
    white-space: nowrap; letter-spacing: 0.5px;
    border: 1px solid; text-align: center;
  }
  .badge.urgent  { background: rgba(80,10,10,0.65);  border-color: rgba(200,70,40,0.55);  color: #f08868; }
  .badge.warn    { background: rgba(70,40,5,0.65);   border-color: rgba(190,140,35,0.50); color: #d4a844; }
  .badge.ok      { background: rgba(10,40,20,0.65);  border-color: rgba(60,145,80,0.40);  color: #80c870; }
  .badge.purple  { background: rgba(28,18,58,0.65);  border-color: rgba(110,85,190,0.40); color: #9a84c0; }
  /* activity already closed at 4 AM reset — muted style */
  .badge.expired { background: rgba(30,22,14,0.55);  border-color: rgba(100,80,40,0.30);  color: rgba(160,130,80,0.55); }

  /* ── Character ───────────────────────────── */
  .bg-character {
    position: absolute;
    bottom: 28px; left: -50px;
    width: 220px;
    pointer-events: none; z-index: 0;
    /* dark-bg removal is handled via canvas pixel processing in main() */
    filter: brightness(1.30) contrast(1.05) sepia(0.18) saturate(0.92);
    -webkit-mask-image:
      linear-gradient(to bottom, black 55%, transparent 92%),
      linear-gradient(to right, transparent 8%, black 35%, black 72%, transparent 100%);
    -webkit-mask-composite: destination-in;
    mask-image:
      linear-gradient(to bottom, black 55%, transparent 92%),
      linear-gradient(to right, transparent 8%, black 35%, black 72%, transparent 100%);
    mask-composite: intersect;
  }

  /* ── Footer ──────────────────────────────── */
  .footer {
    display: flex; align-items: center; gap: 12px;
    background: rgba(6,4,1,0.97);
    border: 1px solid rgba(140,100,30,0.28);
    border-radius: 3px;
    padding: 10px 22px;
    font-size: 13px;
  }
  .footer-label { color: rgba(160,120,50,0.52); font-style: italic; }
  .footer-link  { color: #b89050; letter-spacing: 0.5px; }
  .footer-sep   { color: rgba(160,120,50,0.26); }
  .footer-arrow { color: rgba(180,140,50,0.44); }
</style>
</head>
<body>
<div class="root">

  <div class="title-area">
    <div class="title-rule"></div>
    <span class="title-knot">✦</span>
    <h1>GNG 活动日历</h1>
    <span class="title-knot">✦</span>
    <div class="title-rule right"></div>
  </div>

  <div class="today-row">
    <div class="today-cell">
      <span class="today-label">Today</span>
      <span class="today-gem">◆</span>
      <span class="today-date">${today}</span>
    </div>
    <div class="today-cell">
      <span class="cell-icon" style="color:#c9a84c">⚔</span>
      <span class="cell-num">${active.length}</span>
      <span class="cell-label">正在进行</span>
    </div>
    <div class="today-cell">
      <span class="cell-icon" style="color:#9a84c0">🔮</span>
      <span class="cell-num">${upcoming.length}</span>
      <span class="cell-label">即将开始</span>
    </div>
    <div class="today-cell">
      <span class="cell-reset">⏳ 凌晨 4:00 重置</span>
    </div>
  </div>

  <div class="main-layout">
    <div class="cal-panel">
      <span class="corner-rt">❧</span>
      <span class="corner-lb">❧</span>
      <div class="cal-month">${monthZh}</div>
      <div class="cal-divider">
        <div class="cal-div-line"></div>
        <span class="cal-div-gem">◆</span>
        <div class="cal-div-line"></div>
      </div>
      <div class="cal-weekdays">
        <div class="cal-wd">一</div><div class="cal-wd">二</div><div class="cal-wd">三</div>
        <div class="cal-wd">四</div><div class="cal-wd">五</div>
        <div class="cal-wd">六</div><div class="cal-wd">日</div>
      </div>
      ${calendarGrid(today)}
    </div>

    <div class="panels">
      <div class="panel active-panel">
        <div class="section-header">
          <span class="section-rune" style="color:#c9a84c">⚔</span>
          <span class="section-title active">正在进行</span>
          <span class="section-sub">— 共 ${active.length} 项 —</span>
        </div>
        ${active.length
          ? active.map(a => actRow(a, true)).join('')
          : '<div style="color:rgba(200,160,80,0.35);font-size:14px;padding:8px 0;font-style:italic">· 暂无进行中的活动 ·</div>'}
      </div>
      <div class="panel upcoming-panel">
        <div class="section-header">
          <span class="section-rune" style="color:#9a84c0">🔮</span>
          <span class="section-title upcoming">即将开始</span>
          <span class="section-sub">— 共 ${upcoming.length} 项 —</span>
        </div>
        ${upcoming.length
          ? upcoming.map(a => actRow(a, false)).join('')
          : '<div style="color:rgba(150,120,200,0.35);font-size:14px;padding:8px 0;font-style:italic">· 暂无即将开始的活动 ·</div>'}
      </div>
    </div>
  </div>

  ${charHtml}

  <div class="footer">
    <span class="footer-label">阅览殿堂 ·</span>
    <span class="footer-link">${webUrl}</span>
    <span class="footer-sep">|</span>
    <span class="footer-arrow">↗</span>
  </div>

</div>
</body>
</html>`;
}

// ─── main ─────────────────────────────────────────────────────

function findChromium() {
  const { execSync } = require('child_process');
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/snap/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const p of candidates) {
    try { require('fs').accessSync(p); return p; } catch {}
  }
  try { return execSync('which chromium || which chromium-browser || which google-chrome', { encoding: 'utf8' }).trim(); } catch {}
  return undefined;
}

async function main() {
  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }

  const data  = await fetchJson(apiUrl);
  const { today, hour: bjHour } = bjNow();

  const bgPath   = path.join(BASE_DIR, 'public', 'images', 'bg-map.png');
  const charPath = path.join(BASE_DIR, 'public', 'images', 'bg-character.png');
  const bgBase64   = fs.existsSync(bgPath)   ? fs.readFileSync(bgPath).toString('base64')   : null;
  const charBase64 = fs.existsSync(charPath) ? fs.readFileSync(charPath).toString('base64') : null;

  const html = buildHtml(data, today, bgBase64, charBase64, bjHour);

  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  const chromePath = findChromium();
  if (chromePath) launchOpts.executablePath = chromePath;
  const browser = await puppeteer.launch(launchOpts);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Remove background from the character image using BFS flood-fill from
    // the image corners. We sample the corner pixels to detect the background
    // colour, then flood-fill outward from every edge: pixels whose colour is
    // "close enough" to the background are made transparent. Because the fill
    // only travels through connected background regions it never touches the
    // character's dark clothing / legs, even if they are similarly dark.
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const img = document.querySelector('.bg-character');
        if (!img) { resolve(); return; }

        const process = () => {
          const c = document.createElement('canvas');
          c.width  = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const id = ctx.getImageData(0, 0, c.width, c.height);
          const d  = id.data;
          const W  = c.width, H = c.height;

          // ── 1. Sample background colour from image corners ───────────
          let bgR = 0, bgG = 0, bgB = 0;
          const corners = [[0,0],[1,0],[0,1],[W-1,0],[W-1,1],[0,H-1],[1,H-1],[W-1,H-1]];
          for (const [x, y] of corners) {
            const i = (y * W + x) * 4;
            bgR += d[i]; bgG += d[i+1]; bgB += d[i+2];
          }
          bgR = Math.round(bgR / corners.length);
          bgG = Math.round(bgG / corners.length);
          bgB = Math.round(bgB / corners.length);

          const TOLERANCE = 42; // colour-distance threshold
          const colorDist = (pi) => Math.sqrt(
            (d[pi]   - bgR) ** 2 +
            (d[pi+1] - bgG) ** 2 +
            (d[pi+2] - bgB) ** 2
          );

          // ── 2. BFS flood-fill from all four corners ──────────────────
          const vis = new Uint8Array(W * H);
          // Use a flat typed array as a fast queue of pixel indices
          const queue = new Int32Array(W * H);
          let qHead = 0, qTail = 0;

          const enqueue = (x, y) => {
            const ni = y * W + x;
            if (!vis[ni]) { vis[ni] = 1; queue[qTail++] = ni; }
          };

          enqueue(0, 0); enqueue(W - 1, 0);
          enqueue(0, H - 1); enqueue(W - 1, H - 1);

          // Also seed the entire border so partial-transparent edges are caught
          for (let x = 0; x < W; x++) { enqueue(x, 0); enqueue(x, H - 1); }
          for (let y = 0; y < H; y++) { enqueue(0, y); enqueue(W - 1, y); }

          const DX = [0, 0, 1, -1];
          const DY = [1, -1, 0, 0];

          while (qHead < qTail) {
            const pos = queue[qHead++];
            const x = pos % W, y = (pos / W) | 0;
            const pi = pos * 4;

            if (colorDist(pi) <= TOLERANCE) {
              d[pi + 3] = 0; // make transparent
              for (let k = 0; k < 4; k++) {
                const nx = x + DX[k], ny = y + DY[k];
                if (nx >= 0 && nx < W && ny >= 0 && ny < H) enqueue(nx, ny);
              }
            }
          }

          ctx.putImageData(id, 0, 0);
          const newSrc = c.toDataURL('image/png');
          img.onload = resolve;
          img.src = newSrc;
        };

        img.complete && img.naturalWidth > 0 ? process() : (img.onload = process);
      });
    });

    await new Promise(r => setTimeout(r, 200));

    const bodyH = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: 1200, height: bodyH, deviceScaleFactor: 2 });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: true, type: 'png' });

    const size = fs.statSync(outPath).size;
    console.log(JSON.stringify({ ok: true, out_path: outPath, bytes: size }));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
