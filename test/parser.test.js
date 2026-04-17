'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../parser');

test('parseCalendarGantt resolves season years from a reference date', () => {
  const calendarRows = Array.from({ length: 31 }, () => []);
  calendarRows[3][29] = '8/30';
  calendarRows[3][30] = '8/31';
  calendarRows[3][31] = '1/02';
  calendarRows[3][32] = '1/03';

  calendarRows[8][0] = '任务活动';
  calendarRows[8][29] = '活动A';
  calendarRows[8][31] = '活动B';

  const activities = parser._internal.parseCalendarGantt(calendarRows, {
    referenceDate: new Date('2026-04-17T00:00:00Z'),
  });

  assert.equal(activities[0].startDate, '2025-08-30');
  assert.equal(activities[0].endDate, '2025-08-31');
  assert.equal(activities[1].startDate, '2026-01-02');
});
