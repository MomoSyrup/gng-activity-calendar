(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.GngActivityDisplay = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function activityIdentityKey(activity) {
    return [
      (activity && activity.name) || '',
      (activity && activity.startDate) || '',
      (activity && activity.endDate) || '',
      (activity && activity.source) || '',
      (activity && activity.category) || '',
    ].join('|');
  }

  function compareActivitiesByPeriod(a, b) {
    var aStart = (a && a.startDate) || '9999-99-99';
    var bStart = (b && b.startDate) || '9999-99-99';
    if (aStart !== bStart) return aStart.localeCompare(bStart);

    var aEnd = (a && (a.endDate || a.startDate)) || '9999-99-99';
    var bEnd = (b && (b.endDate || b.startDate)) || '9999-99-99';
    return aEnd.localeCompare(bEnd);
  }

  function buildPeriodIndexMap(activities) {
    var byName = {};
    (activities || []).forEach(function (activity) {
      var name = (activity && activity.name) || '';
      if (!name) return;
      if (!byName[name]) byName[name] = [];
      byName[name].push(activity);
    });

    var map = {};
    Object.keys(byName).forEach(function (name) {
      var list = byName[name].slice().sort(compareActivitiesByPeriod);
      if (list.length <= 1) return;
      list.forEach(function (activity, index) {
        map[activityIdentityKey(activity)] = index + 1;
      });
    });

    return map;
  }

  function formatPeriodDisplay(baseName, periodIndex) {
    return baseName + '（第' + periodIndex + '期）';
  }

  function getDisplayName(activity, periodMap, options) {
    var settings = options || {};
    var baseName = settings.baseName != null
      ? settings.baseName
      : (((activity && activity.name) || '').trim());
    var periodIndex = periodMap ? periodMap[activityIdentityKey(activity)] : null;
    if (!periodIndex) return baseName;

    var formatter = typeof settings.periodFormatter === 'function'
      ? settings.periodFormatter
      : formatPeriodDisplay;
    return formatter(baseName, periodIndex);
  }

  return {
    activityIdentityKey: activityIdentityKey,
    buildPeriodIndexMap: buildPeriodIndexMap,
    compareActivitiesByPeriod: compareActivitiesByPeriod,
    formatPeriodDisplay: formatPeriodDisplay,
    getDisplayName: getDisplayName,
  };
});
