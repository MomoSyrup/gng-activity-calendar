'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const insights = require('../shared/activity-insights');

test('getStatusKey classifies active, upcoming, ended and undated activities', () => {
  assert.equal(
    insights.getStatusKey({ startDate: '2026-04-20', endDate: '2026-04-25' }, '2026-04-21'),
    'active'
  );
  assert.equal(
    insights.getStatusKey({ startDate: '2026-04-22', endDate: '2026-04-25' }, '2026-04-21'),
    'upcoming'
  );
  assert.equal(
    insights.getStatusKey({ startDate: '2026-04-10', endDate: '2026-04-18' }, '2026-04-21'),
    'ended'
  );
  assert.equal(insights.getStatusKey({ name: 'No Schedule' }, '2026-04-21'), 'undated');
});

test('getAnomalyFlags skips missing-event warnings for web activities', () => {
  const anomalies = insights.getAnomalyFlags({
    name: 'Web Event',
    startDate: '2026-04-22',
    endDate: '2026-04-24',
    types: ['网页活动'],
    rewards: [{ name: 'Gold' }],
  });

  assert.deepEqual(anomalies, []);
});

test('getAnomalyFlags reports unconfigured, missing event and rewards', () => {
  const anomalies = insights.getAnomalyFlags({
    name: 'Broken Event',
    startDate: '2026-04-22',
    types: ['未配置'],
    rewards: [],
  });

  assert.deepEqual(
    anomalies.sort(),
    ['missing_end', 'missing_event', 'missing_rewards', 'unconfigured']
  );
});

test('filterActivities supports search, status, rewards and anomaly filters', () => {
  const activities = [
    {
      name: 'Alpha',
      source: 'sheet-a',
      startDate: '2026-04-21',
      endDate: '2026-04-23',
      rewards: [{ name: 'Coin' }],
      types: ['任务活动'],
      eventId: '1001',
    },
    {
      name: 'Beta',
      source: 'sheet-b',
      startDate: '2026-04-25',
      endDate: '2026-04-30',
      rewards: [],
      types: ['未配置'],
      eventId: null,
    },
  ];

  assert.equal(
    insights.filterActivities(activities, { search: 'alpha' }, '2026-04-21').length,
    1
  );
  assert.equal(
    insights.filterActivities(activities, { status: 'upcoming' }, '2026-04-21').length,
    1
  );
  assert.equal(
    insights.filterActivities(activities, { rewards: 'missing' }, '2026-04-21')[0].name,
    'Beta'
  );
  assert.equal(
    insights.filterActivities(activities, { anomaly: 'only' }, '2026-04-21')[0].name,
    'Beta'
  );
});

test('buildUpcomingGroups groups future activities by start date', () => {
  const groups = insights.buildUpcomingGroups([
    { name: 'Alpha', startDate: '2026-04-22', endDate: '2026-04-24' },
    { name: 'Beta', startDate: '2026-04-22', endDate: '2026-04-25' },
    { name: 'Gamma', startDate: '2026-04-29', endDate: '2026-04-30' },
  ], 8, '2026-04-21');

  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, '2026-04-22');
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].date, '2026-04-29');
});

test('getStableActivityKey prefers event id and falls back to stable fields', () => {
  assert.equal(
    insights.getStableActivityKey({ name: 'Alpha', eventId: 1001, source: 'sheet-a' }),
    'event:1001'
  );

  assert.equal(
    insights.getStableActivityKey({
      name: 'Fallback Event',
      source: 'sheet-b',
      category: 'campaign',
      excelName: 'Fallback Sheet Name',
    }),
    'fallback|Fallback Event|sheet-b|campaign|Fallback Sheet Name'
  );
});

test('buildOperationsStats summarizes pace, coverage, anomalies and durations', () => {
  const activities = [
    {
      name: 'Alpha',
      source: 'sheet-a',
      startDate: '2026-04-20',
      endDate: '2026-04-25',
      rewards: [{ name: 'Coin' }],
      types: ['任务活动'],
      eventId: '1001',
    },
    {
      name: 'Beta',
      source: 'sheet-a',
      startDate: '2026-04-23',
      endDate: '2026-04-24',
      rewards: [],
      types: ['未配置'],
      eventId: null,
    },
    {
      name: 'Gamma',
      source: 'sheet-b',
      startDate: '2026-04-01',
      endDate: '2026-04-02',
      rewards: [{ name: 'Gem' }],
      types: ['网页活动'],
      eventId: null,
    },
  ];

  const stats = insights.buildOperationsStats(activities, '2026-04-21');

  assert.equal(stats.total, 3);
  assert.deepEqual(stats.statusCounts, {
    active: 1,
    upcoming: 1,
    ended: 1,
    undated: 0,
  });
  assert.deepEqual(stats.cadence, {
    today: 1,
    thisWeek: 2,
    thisMonth: 3,
    next7: 1,
    next14: 1,
    next30: 1,
  });
  assert.deepEqual(stats.coverage.rewards, {
    withCount: 2,
    withoutCount: 1,
    pct: 67,
  });
  assert.deepEqual(stats.coverage.event, {
    withCount: 1,
    withoutCount: 2,
    pct: 33,
  });
  assert.deepEqual(stats.coverage.typing, {
    configuredCount: 2,
    unconfiguredCount: 1,
    pct: 67,
  });
  assert.deepEqual(stats.coverage.schedule, {
    completeCount: 3,
    incompleteCount: 0,
    pct: 100,
  });
  assert.equal(stats.durations.averageDays, 3.3);
  assert.equal(stats.durations.medianDays, 2);
  assert.equal(stats.durations.longest.days, 6);
  assert.equal(stats.durations.longest.activity.name, 'Alpha');
  assert.equal(stats.durations.shortest.days, 2);
  assert.equal(stats.anomalies.all, 1);
  assert.equal(stats.anomalies.unconfigured, 1);
  assert.equal(stats.breakdowns.types[0].label, '任务活动');
  assert.equal(stats.breakdowns.sources[0].label, 'sheet-a');
  assert.equal(stats.breakdowns.sources[0].count, 2);
});

test('diffActivityLists tracks added, removed and changed activities by stable key', () => {
  const previous = [
    {
      name: 'Alpha',
      source: 'sheet-a',
      startDate: '2026-04-20',
      endDate: '2026-04-25',
      rewards: [{ name: 'Coin' }],
      types: ['任务活动'],
      eventId: '1001',
    },
    {
      name: 'Beta',
      source: 'sheet-b',
      startDate: '2026-04-23',
      endDate: '2026-04-24',
      rewards: [],
      types: ['未配置'],
      category: 'ops',
      excelName: 'Beta Sheet',
    },
    {
      name: 'Delta',
      source: 'sheet-c',
      startDate: '2026-04-10',
      endDate: '2026-04-11',
      rewards: [],
      types: ['任务活动'],
      eventId: '3001',
    },
  ];

  const next = [
    {
      name: 'Alpha',
      source: 'sheet-a',
      startDate: '2026-04-20',
      endDate: '2026-04-26',
      rewards: [{ name: 'Coin' }, { name: 'Gem' }],
      types: ['任务活动'],
      eventId: '1001',
    },
    {
      name: 'Beta',
      source: 'sheet-b',
      startDate: '2026-04-23',
      endDate: '2026-04-24',
      rewards: [],
      types: ['兑换活动'],
      category: 'ops',
      excelName: 'Beta Sheet',
    },
    {
      name: 'Gamma',
      source: 'sheet-d',
      startDate: '2026-04-28',
      endDate: '2026-04-30',
      rewards: [{ name: 'Box' }],
      types: ['抽奖活动'],
      eventId: '2001',
    },
  ];

  const diff = insights.diffActivityLists(previous, next);

  assert.deepEqual(diff.summary, {
    added: 1,
    removed: 1,
    date_changed: 1,
    type_changed: 1,
    reward_changed: 1,
    total: 5,
  });
  assert.equal(diff.entries.length, 5);
  assert.ok(diff.changedStableKeys.includes('event:1001'));
  assert.ok(diff.changedStableKeys.includes('event:2001'));
  assert.ok(diff.changedStableKeys.includes('fallback|Beta|sheet-b|ops|Beta Sheet'));
  assert.ok(!diff.changedStableKeys.includes('event:3001'));
});
