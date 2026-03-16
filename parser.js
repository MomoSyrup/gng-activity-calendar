const DATE_RE = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/;

function normalizeDate(text) {
  if (!text) return null;
  const m = String(text).match(DATE_RE);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isEmpty(row) {
  return !row || row.length === 0 || row.every(c => !c || !String(c).trim());
}

function c(row, i) {
  return row && i < row.length ? String(row[i] || '').trim() : '';
}

function allDates(row) {
  if (!row) return [];
  const out = [];
  for (const cell of row) {
    const d = normalizeDate(cell);
    if (d) out.push(d);
  }
  return out;
}

function findDuration(row) {
  if (!row) return null;
  for (const cell of row) {
    if (!cell) continue;
    const s = String(cell);
    const m = s.match(/(\d+)\s*天/) || s.match(/活动周期[：:]\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function maintenanceDate(row) {
  if (!row) return null;
  for (const cell of row) {
    const m = String(cell || '').match(/(\d{4}\/\d{1,2}\/\d{1,2})维护/);
    if (m) return normalizeDate(m[1]);
  }
  return null;
}

// ---- Reward extraction ----

function findRewardColumns(headerRow) {
  const pairs = [];
  for (let i = 0; i < headerRow.length; i++) {
    const v = c(headerRow, i);
    if (v === '名称' || v === '物品名称') {
      let idCol = -1;
      for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
        const hv = c(headerRow, k);
        if (/^(物品ID|奖励\d*|奖励1)$/i.test(hv) || /^reward$/i.test(hv)) {
          idCol = k;
          break;
        }
      }
      if (idCol === -1 && i >= 2 && c(headerRow, i - 1) === '数量') {
        idCol = i - 2;
      }
      if (idCol === -1 && i >= 1) {
        idCol = i - 1;
      }
      pairs.push({ nameCol: i, idCol });
    }
  }
  return pairs;
}

function extractRewardsFromBlock(rows, start, end) {
  const rewards = [];
  const seen = new Set();
  let i = start;

  while (i < end) {
    const row = rows[i];
    if (isEmpty(row)) { i++; continue; }

    const pairs = findRewardColumns(row);
    if (pairs.length === 0) { i++; continue; }

    for (let j = i + 1; j < end; j++) {
      const dr = rows[j];
      if (isEmpty(dr)) break;
      for (const { nameCol, idCol } of pairs) {
        const name = c(dr, nameCol);
        const rawId = idCol >= 0 ? c(dr, idCol) : '';
        const itemId = /^\d{4,}$/.test(rawId) ? rawId : '';
        if (name && /[\u4e00-\u9fff]/.test(name) && name.length >= 2 && name.length <= 25) {
          const key = name + '|' + itemId;
          if (!seen.has(key)) {
            seen.add(key);
            rewards.push({ name, itemId });
          }
        }
      }
    }
    i++;
  }
  return rewards;
}

// ---- Activity detection ----

const SKIP_TITLES = new Set([
  '序号', '条件', '任务奖励', '兑换奖励', '任务条件', '免费投放', '来源',
  '奖池', '奖励', '功能测试', '活动时间', '物品', '返场',
  '长线核心', '核心', '填充', '高级填充', '活跃核心', '新增物品',
  '地狱场总产出', '礼物树局内产出',
]);

function looksLikeTitle(text) {
  if (!text || text.length < 2 || text.length > 35) return false;
  if (!/[\u4e00-\u9fff]/.test(text)) return false;
  if (SKIP_TITLES.has(text)) return false;
  if (/^(第[一二三四五六七八九十]+期|累计登录|在活动期间|开始时间|结束时间|单局|单抽|普通|挑战|地狱)/.test(text)) return false;
  if (/^(token|price|key int|C\+B|老玩家|EVENT ID)/.test(text)) return false;
  if (/^\*/.test(text)) return false;
  return true;
}

// ---- Chinese ↔ English activity name aliases ----

const NAME_ALIASES = [
  ['石中剑', 'Sword in the Stone', 'Blizzard & Sword'],
  ['职业荣誉挑战', 'Class Glory challenge'],
  ['职业荣耀挑战', 'Class Glory challenge'],
  ['礼物树', 'Miracle Tree'],
  ['奇迹之树', 'Miracle Tree'],
  ['黄金巡逻队', 'Golden Patrol'],
  ['哥布林荣誉挑战', "Goblin's Treasure"],
  ['拉马丹哥布林荣誉挑战', 'ramadan goblin event'],
  ['雪人活动', 'Prankster Snowman'],
  ['雪人活动二期', 'Prankster Snowman'],
  ['雪人活动三期', 'Prankster Snowman'],
  ['石像鬼入侵', 'Monster Invasion'],
  ['怪物入侵', 'Monster Invasion'],
  ['木头人活动', 'Tungtungtung Sahur', 'Tungtungtung'],
  ['木头人二期', 'Tungtungtung Sahur'],
  ['箱中果', 'Special Chest'],
  ['排位赛季末冲刺', '赛季末冲刺'],
  ['海岛图荣耀挑战', '海岛挑战', 'Dark Cave Glory challenge'],
  ['海盗图荣耀挑战', '海岛挑战', 'Dark Cave Glory challenge'],
  ['海岛挑战', 'Dark cave port bring out value'],
  ['拉马丹ID荣誉挑战', 'ramadan'],
  ['周末补给', 'weekend supply'],
  ['周末猛攻', 'weekend Assault'],
  ['99兑换商店', 'Revelry of Ragnarok'],
  ['圣诞礼物', 'christmas present'],
  ['藏品线索', 'ice dragon scale clue'],
  ['许愿活动', 'make a wish'],
  ['赛季组队冲刺网页活动', '佣兵赏金', "Mercenary's Grand Bounty"],
  ['赛季登录', 'seasonal login'],
  ['三王礼物', "three kings' present"],
  ['新赛季皮肤奖励', 'promising skin reward in new season'],
];

// ---- Gantt chart parser (second spreadsheet) ----

const GANTT_TAG_RE = /^(mission|misson|challenge\s*mission|exchange\s*store|non-replacement\s*gacha|h5|challenge)$/i;

function cleanGanttLine(line) {
  let name = line.trim();
  if (!name) return '';
  if (name.startsWith('【')) {
    const endIdx = name.indexOf('】');
    if (endIdx >= 0) {
      const inside = name.slice(1, endIdx).trim();
      const after = name.slice(endIdx + 1).trim();
      // If inside is a known category tag, the activity name is after
      name = GANTT_TAG_RE.test(inside) ? (after || inside) : inside;
    }
  }
  // "H5【Mercenary's Grand Bounty】" → extract inside brackets
  const midMatch = name.match(/^[A-Za-z0-9]+\s*【([^】]+)】/);
  if (midMatch) {
    name = midMatch[1].trim();
  }
  name = name.replace(/【.*$/, '').trim();
  return name;
}

function ganttCellName(text) {
  if (!text) return '';
  return cleanGanttLine(text.split('\n')[0]);
}

// Extract all activity names from a multi-line cell (some cells pack multiple activities)
const GANTT_LINE_SKIP_RE = /^\d+\/\d+\s*hotfix|^grand prize|^rules:|^[·\-\*]\s*\w|^[·\-]|^skin[：:]|^-?\s*(treasure|skin|avatar|frame|weapon|cloak|gold|key|mandate|purple|new class)/i;

function ganttCellNames(text) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const names = [];
  for (const line of lines) {
    if (GANTT_LINE_SKIP_RE.test(line)) continue;
    let name = cleanGanttLine(line);
    name = name.replace(/[（(].{10,}$/, '').trim();
    if (name && name.length >= 2) names.push(name);
  }
  return names;
}

const GANTT_SKIP = new Set([
  'lucky weekend supply', 'weekend supply', 'weekend assault',
  'treasure uppp', 'calendar', 'peak day', '3/4 hotfix', '3/13 hotfix',
  '兑换商店', '头像', '头像框', '名片底图', '角色皮肤', '武器皮肤',
]);

const GANTT_SKIP_RE = /banner$|兑换商店$|frame$|avatar$|^(MX treasure|MX local treasure|treasure |research$|sword in stone research|miracle tree research|goblin research|snowman research|monster invasion research|开服公告|通缉令|Battlepass$|rank tier|gold cap|blood|血坦角色|Rank$|Treasure$|开斋哥布林$|商城上新|石中剑抽奖|Miracle Tree Frame|海怪头像框)/i;

function preferChineseNames(names) {
  if (names.length <= 1) return names;
  const keep = [];
  const consumed = new Set();
  for (let i = 0; i < names.length; i++) {
    if (consumed.has(i)) continue;
    const a = names[i];
    const aCn = hasChinese(a);
    let merged = false;
    for (let j = i + 1; j < names.length; j++) {
      if (consumed.has(j)) continue;
      const b = names[j];
      const bCn = hasChinese(b);
      if (aCn === bCn) continue;
      if (fuzzyMatch(a, b)) {
        keep.push(aCn ? a : b);
        consumed.add(i);
        consumed.add(j);
        merged = true;
        break;
      }
    }
    if (!merged && !consumed.has(i)) keep.push(a);
  }
  for (let i = 0; i < names.length; i++) {
    if (!consumed.has(i) && !keep.includes(names[i])) keep.push(names[i]);
  }
  return keep;
}

function parseCalendarGantt(calendarRows) {
  if (!calendarRows || calendarRows.length < 5) return [];

  const dateRow = calendarRows[3];
  if (!dateRow) return [];

  const COL_START = 29;
  const colToDate = {};
  for (let ci = COL_START; ci < dateRow.length; ci++) {
    const cell = String(dateRow[ci] || '').trim();
    const m = cell.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      const month = parseInt(m[1], 10);
      const day = parseInt(m[2], 10);
      const year = month >= 8 ? 2025 : 2026;
      colToDate[ci] = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const results = [];
  const ROWS_TO_PARSE = [8, 11, 13, 15, 16, 17, 18, 19, 20, 24, 29, 30];

  for (const r of ROWS_TO_PARSE) {
    if (r >= calendarRows.length) continue;
    const row = calendarRows[r];
    if (!row) continue;

    const category = String(row[0] || '').trim();

    // Collect all non-empty cells in the calendar area
    const cells = [];
    for (let ci = COL_START; ci < row.length; ci++) {
      const raw = String(row[ci] || '').trim();
      if (raw) cells.push({ col: ci, raw });
    }

    // Each cell = one or more activities; end date = day before next cell
    for (let i = 0; i < cells.length; i++) {
      const { col, raw } = cells[i];
      const names = ganttCellNames(raw);

      const startDate = colToDate[col] || null;
      let endDate = null;
      if (i + 1 < cells.length) {
        const nextCol = cells[i + 1].col;
        const endCol = nextCol - 1;
        endDate = colToDate[endCol] || null;
      } else {
        if (startDate) endDate = addDays(startDate, 13);
      }

      // Filter skipped names
      const validNames = names.filter(n => !GANTT_SKIP.has(n.toLowerCase()) && !GANTT_SKIP_RE.test(n));
      // Within the same cell, prefer Chinese name over English when they're aliases
      const finalNames = preferChineseNames(validNames);
      for (const name of finalNames) {
        results.push({ name, source: '1.0 event calendar', category, startDate, endDate, rewards: [] });
      }
    }
  }
  return results;
}

// ---- Main parser ----

function parseConfigSheet(configRows) {
  if (!configRows || configRows.length < 5) return [];
  const activities = [];
  let curName = null;
  let curStart = -1;

  for (let i = 0; i < configRows.length; i++) {
    const row = configRows[i];
    if (!row) continue;
    const c0 = String(row[0] || '').trim();
    // Activity section headers: "新手签到", "猎人试炼", "荣耀之路" etc.
    if (c0 && /[\u4e00-\u9fff]/.test(c0) && c0.length >= 2 && c0.length <= 15 && !row[1]) {
      if (curName && curStart >= 0) {
        const rewards = extractRewardsFromBlock(configRows, curStart, i);
        activities.push({ name: curName, source: '活动配置', startDate: null, endDate: null, rewards });
      }
      curName = c0;
      curStart = i + 1;
    }
  }
  if (curName && curStart >= 0) {
    const rewards = extractRewardsFromBlock(configRows, curStart, configRows.length);
    activities.push({ name: curName, source: '活动配置', startDate: null, endDate: null, rewards });
  }
  return activities;
}

function hasChinese(name) { return /[\u4e00-\u9fff]/.test(name); }

function datesOverlap(a, b) {
  if (!a.startDate || !b.startDate) return false;
  const aEnd = a.endDate || a.startDate;
  const bEnd = b.endDate || b.startDate;
  return a.startDate <= bEnd && b.startDate <= aEnd;
}

function mergeCnEnDuplicates(activities) {
  const removed = new Set();

  for (let i = 0; i < activities.length; i++) {
    if (removed.has(i)) continue;
    const a = activities[i];
    const aCn = hasChinese(a.name);

    for (let j = i + 1; j < activities.length; j++) {
      if (removed.has(j)) continue;
      const b = activities[j];
      const bCn = hasChinese(b.name);

      // Only merge if one is Chinese and the other is English
      if (aCn === bCn) continue;
      if (!fuzzyMatch(a.name, b.name)) continue;
      if (!datesOverlap(a, b)) continue;

      // Keep the Chinese one, absorb the English one
      const keeper = aCn ? a : b;
      const donor = aCn ? b : a;
      const removedIdx = aCn ? j : i;

      // Widen date range to cover both
      if (donor.startDate && (!keeper.startDate || donor.startDate < keeper.startDate)) {
        keeper.startDate = donor.startDate;
      }
      if (donor.endDate && (!keeper.endDate || donor.endDate > keeper.endDate)) {
        keeper.endDate = donor.endDate;
      }
      // Absorb rewards if keeper has none
      if (keeper.rewards.length === 0 && donor.rewards.length > 0) {
        keeper.rewards = donor.rewards;
      }

      removed.add(removedIdx);
      if (removedIdx === i) break;
    }
  }

  return activities.filter((_, idx) => !removed.has(idx));
}

function parseActivities(sheetsData, calendarRows, configRows) {
  const activities = [];
  const skip = new Set(['item表参照', '2D资源ID', '活动奖励模板（施工中）', '周末大金UP']);

  for (const sheetName of sheetsData.sheetNames) {
    if (skip.has(sheetName)) continue;
    const rows = sheetsData.sheets[sheetName];
    if (!rows || rows.length < 2) continue;
    activities.push(...parseSheet(rows, sheetName));
  }

  // Add newbie/config activities from Sheet 2 活动配置
  const configActs = parseConfigSheet(configRows);
  for (const ca of configActs) {
    const existing = activities.find(a => fuzzyMatch(a.name, ca.name));
    if (existing) {
      if (existing.rewards.length === 0 && ca.rewards.length > 0) {
        existing.rewards = ca.rewards;
      }
    } else {
      activities.push(ca);
    }
  }

  // Merge calendar Gantt chart data: supplement missing dates & add new activities
  const ganttActivities = parseCalendarGantt(calendarRows);
  const addedGanttKeys = new Set();
  for (const ga of ganttActivities) {
    const gaKey = `${ga.name}|${ga.startDate}`;
    if (addedGanttKeys.has(gaKey)) continue;
    addedGanttKeys.add(gaKey);

    // Find Sheet 1 activities without dates that match this Gantt entry
    const noDateMatches = activities.filter(a => !a.startDate && fuzzyMatch(a.name, ga.name));
    if (noDateMatches.length > 0) {
      const match = noDateMatches[0];
      match.startDate = ga.startDate;
      if (!match.endDate) match.endDate = ga.endDate;
    } else {
      // Check if any activity (with dates) already covers this
      const existing = activities.find(a => a.startDate && fuzzyMatch(a.name, ga.name));
      // If existing has dates far from this Gantt entry, treat as different activity
      if (existing && ga.startDate && existing.startDate) {
        const daysDiff = Math.abs(
          (new Date(ga.startDate) - new Date(existing.startDate)) / 86400000
        );
        if (daysDiff > 30) {
          activities.push(ga);
        }
      } else if (!existing && ga.startDate) {
        activities.push(ga);
      }
    }
  }

  // Fix invalid date ranges
  for (const a of activities) {
    if (a.startDate && a.endDate && a.endDate < a.startDate) a.endDate = null;
  }

  // Deduplicate: same name + same start date = same entry
  const seen = new Set();
  const deduped = [];
  for (const a of activities) {
    const key = `${a.name.toLowerCase()}|${a.startDate || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }

  // Merge CN/EN pairs: if fuzzyMatch + dates overlap, keep CN name
  const merged = mergeCnEnDuplicates(deduped);

  // Translate remaining English names to Chinese via alias table
  for (const a of merged) {
    if (hasChinese(a.name)) continue;
    const lower = a.name.toLowerCase();
    for (const group of NAME_ALIASES) {
      const hit = group.some((alias) => {
        const al = alias.toLowerCase();
        return lower === al || lower.includes(al) || al.includes(lower);
      });
      if (hit) {
        const cnName = group.find((alias) => hasChinese(alias));
        if (cnName) {
          a.name = cnName;
          break;
        }
      }
    }
  }

  merged.sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9'));
  return merged;
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;

  const aCn = a.replace(/[^\u4e00-\u9fff]/g, '');
  const bCn = b.replace(/[^\u4e00-\u9fff]/g, '');
  if (aCn.length >= 2 && bCn.length >= 2 && (aCn.includes(bCn) || bCn.includes(aCn))) return true;

  // Check if both names match the same alias group (substring match)
  for (const group of NAME_ALIASES) {
    const matchesA = group.some(alias => {
      const ak = alias.toLowerCase();
      return la.includes(ak) || ak.includes(la);
    });
    const matchesB = group.some(alias => {
      const ak = alias.toLowerCase();
      return lb.includes(ak) || ak.includes(lb);
    });
    if (matchesA && matchesB) return true;
  }

  return false;
}

function parseSheet(rows, sheetName) {
  const activities = [];
  const titleRows = [];

  // Pass 1: identify title rows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isEmpty(row)) continue;

    const hasActivityType = row.some(cl => c([cl], 0) === '活动类型');

    // Pattern A: col[0] has name + row has "活动类型"
    if (hasActivityType) {
      const name = c(row, 0) || c(row, 1);
      if (looksLikeTitle(name)) {
        titleRows.push({ idx: i, name, pattern: 'A' });
        continue;
      }
    }

    // Pattern B: col[0] or col[1] has standalone title (few non-empty cells)
    const c0 = c(row, 0);
    const c1 = c(row, 1);
    const candidate = (c1 && looksLikeTitle(c1)) ? c1 : ((c0 && looksLikeTitle(c0)) ? c0 : null);
    if (candidate) {
      const nonEmpty = row.filter(cl => String(cl || '').trim()).length;
      if (nonEmpty <= 2) {
        let hasContext = false;
        for (let k = i + 1; k < Math.min(rows.length, i + 8); k++) {
          const kr = rows[k];
          if (!kr) continue;
          const txt = kr.map(cl => String(cl || '')).join(' ');
          if (/开始时间|结束时间|维护|活动周期|\d{4}[/-]\d|兑换奖励|任务奖励/.test(txt)) {
            hasContext = true;
            break;
          }
        }
        if (hasContext) {
          titleRows.push({ idx: i, name: candidate, pattern: 'B' });
        }
      }
    }
  }

  // Pass 2: for each title, extract dates and rewards
  for (let ti = 0; ti < titleRows.length; ti++) {
    const { idx, name } = titleRows[ti];
    const blockEnd = ti + 1 < titleRows.length ? titleRows[ti + 1].idx : Math.min(rows.length, idx + 80);

    let startDate = null;
    let endDate = null;
    let duration = null;

    // Scan block for dates (limited window to avoid cross-contamination)
    const scanEnd = Math.min(blockEnd, idx + 10);
    for (let j = idx; j < scanEnd; j++) {
      const row = rows[j];
      if (!row) continue;
      const joined = row.map(cl => String(cl || '')).join(' ');

      if (/开始时间/.test(joined)) {
        const d = allDates(row);
        if (d.length > 0) startDate = d[0];
        const durIdx = row.findIndex(cl => String(cl || '').includes('持续时间'));
        if (durIdx >= 0 && durIdx + 1 < row.length) {
          const dv = parseInt(c(row, durIdx + 1), 10);
          if (dv > 0) duration = dv;
        }
        continue;
      }

      if (/结束时间/.test(joined)) {
        const d = allDates(row);
        if (d.length > 0) endDate = d[0];
        continue;
      }

      // Skip "第X期" rows in initial scan — handled by multi-period pass below
      if (/第\d+期/.test(joined)) continue;

      const md = maintenanceDate(row);
      const dates = allDates(row);
      const explicitDates = md ? dates.filter(d => d !== md) : dates;

      if (explicitDates.length >= 2) {
        if (!startDate) startDate = explicitDates[0];
        if (!endDate) endDate = explicitDates[1];
      } else if (explicitDates.length === 1 && j > idx) {
        if (!startDate) startDate = explicitDates[0];
      } else if (md && !startDate) {
        startDate = md;
      }

      if (!duration) duration = findDuration(row);
    }

    // Multi-period scan: aggregate all "第X期" rows to find full date range
    for (let j = idx; j < blockEnd; j++) {
      const row = rows[j];
      if (!row) continue;
      const joined = row.map(cl => String(cl || '')).join(' ');
      if (/第\d+期/.test(joined)) {
        const dates = allDates(row);
        if (dates.length >= 2) {
          if (!startDate || dates[0] < startDate) startDate = dates[0];
          if (!endDate || dates[1] > endDate) endDate = dates[1];
        }
      }
    }

    if (startDate && !endDate && duration) {
      endDate = addDays(startDate, duration);
    }

    const rewards = extractRewardsFromBlock(rows, idx + 1, blockEnd);

    activities.push({ name, source: sheetName, startDate, endDate, rewards });
  }

  // Special: 1.0周末补给 — extract individual date ranges at bottom
  if (sheetName === '1.0周末补给') {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const dates = allDates(row);
      if (dates.length === 2 && !row.some(cl => /条件|名称|奖励/.test(String(cl || '')))) {
        const exists = activities.find(a => a.startDate === dates[0] && a.name === '周末补给');
        if (!exists) {
          const base = activities.find(a => a.source === sheetName);
          activities.push({
            name: '周末补给',
            source: sheetName,
            startDate: dates[0],
            endDate: dates[1],
            rewards: base ? base.rewards : [],
          });
        }
      }
    }
  }

  return activities;
}

module.exports = { parseActivities };
