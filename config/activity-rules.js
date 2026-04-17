'use strict';

const GANTT_COLUMN_START = 29;
const GANTT_ROWS_TO_PARSE = Object.freeze([8, 11, 13, 15, 16, 17, 18, 19, 20, 24, 29, 30]);
const GANTT_SEASON_START_MONTH = 8;

const EXCLUDED_ACTIVITY_NAMES = new Set([
  '网页排位冲刺活动',
]);

const MANUAL_DATE_CORRECTIONS = Object.freeze([
  {
    name: '赛季组队冲刺网页活动',
    startDate: '2026-03-26',
    endDate: '2026-04-08',
    patch: { endDate: '2026-04-14' },
  },
]);

function pad(value) {
  return String(value).padStart(2, '0');
}

function resolveGanttSeasonStartYear(referenceDate) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate || Date.now());
  const month = reference.getUTCMonth() + 1;
  const year = reference.getUTCFullYear();
  return month >= GANTT_SEASON_START_MONTH ? year : year - 1;
}

function resolveGanttDate(month, day, referenceDate) {
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  const seasonStartYear = resolveGanttSeasonStartYear(referenceDate);
  const year = normalizedMonth >= GANTT_SEASON_START_MONTH ? seasonStartYear : seasonStartYear + 1;
  return `${year}-${pad(normalizedMonth)}-${pad(normalizedDay)}`;
}

function isExcludedActivityName(name) {
  return EXCLUDED_ACTIVITY_NAMES.has(String(name || '').trim());
}

function applyManualDateCorrections(activities) {
  return (activities || []).map((activity) => {
    if (!activity) return activity;
    const match = MANUAL_DATE_CORRECTIONS.find((rule) => {
      return (
        activity.name === rule.name &&
        activity.startDate === rule.startDate &&
        activity.endDate === rule.endDate
      );
    });
    return match ? { ...activity, ...match.patch } : activity;
  });
}

module.exports = {
  GANTT_COLUMN_START,
  GANTT_ROWS_TO_PARSE,
  GANTT_SEASON_START_MONTH,
  EXCLUDED_ACTIVITY_NAMES,
  MANUAL_DATE_CORRECTIONS,
  resolveGanttSeasonStartYear,
  resolveGanttDate,
  isExcludedActivityName,
  applyManualDateCorrections,
};
