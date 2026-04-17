'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const activityDisplay = require('../shared/activity-display');

test('buildPeriodIndexMap numbers phases by start date', () => {
  const activities = [
    { name: 'Goblin', startDate: '2026-04-10', endDate: '2026-04-16', source: 'sheet-a' },
    { name: 'Goblin', startDate: '2026-04-01', endDate: '2026-04-09', source: 'sheet-a' },
    { name: 'Snowman', startDate: '2026-04-01', endDate: '2026-04-10', source: 'sheet-b' },
  ];

  const map = activityDisplay.buildPeriodIndexMap(activities);

  assert.equal(map[activityDisplay.activityIdentityKey(activities[0])], 2);
  assert.equal(map[activityDisplay.activityIdentityKey(activities[1])], 1);
  assert.equal(map[activityDisplay.activityIdentityKey(activities[2])], undefined);
});

test('getDisplayName can format a custom base title with period suffix', () => {
  const activity = {
    name: '赛季登录',
    startDate: '2026-04-01',
    endDate: '2026-04-09',
    source: 'sheet-a',
  };
  const map = {};
  map[activityDisplay.activityIdentityKey(activity)] = 3;

  const displayName = activityDisplay.getDisplayName(activity, map, {
    baseName: 'Season Login',
  });

  assert.equal(displayName, 'Season Login（第3期）');
});
