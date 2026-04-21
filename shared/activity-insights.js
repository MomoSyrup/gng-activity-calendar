(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.GngActivityInsights = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TYPE_UNCONFIGURED = '未配置';
  var TYPE_WEB = '网页活动';
  var TYPE_OVERVIEW = '仅说明页活动';

  var ANOMALY_LABELS = {
    unconfigured: '未配置类型',
    missing_event: '未绑定 Event',
    missing_start: '缺少开始日期',
    missing_end: '缺少结束日期',
    missing_rewards: '无奖励配置',
  };

  function unique(list) {
    return Array.from(new Set(list || []));
  }

  function pad(num) {
    return String(num).padStart(2, '0');
  }

  function dateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join('-');
  }

  function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    var parts = dateStr.split('-').map(Number);
    if (parts.length !== 3 || parts.some(function (part) { return Number.isNaN(part); })) {
      return null;
    }
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(date, days) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function startOfWeek(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    var day = date.getDay();
    var offset = day === 0 ? -6 : (1 - day);
    return addDays(date, offset);
  }

  function endOfWeek(date) {
    var start = startOfWeek(date);
    return start ? addDays(start, 6) : null;
  }

  function startOfMonth(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfMonth(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function compareDateStr(a, b) {
    return String(a || '').localeCompare(String(b || ''));
  }

  function getEndDate(activity) {
    if (!activity) return '';
    return activity.endDate || activity.startDate || '';
  }

  function hasType(activity, typeName) {
    return Array.isArray(activity && activity.types) && activity.types.indexOf(typeName) !== -1;
  }

  function hasRewards(activity) {
    return Array.isArray(activity && activity.rewards) && activity.rewards.length > 0;
  }

  function getStableActivityKey(activity) {
    if (!activity) return '';
    if (activity.eventId != null && activity.eventId !== '') {
      return 'event:' + String(activity.eventId);
    }
    return [
      'fallback',
      activity.name || '',
      activity.source || '',
      activity.category || '',
      activity.excelName || '',
    ].join('|');
  }

  function getStatusKey(activity, todayStr) {
    if (!activity || !activity.startDate) return 'undated';
    var endDate = getEndDate(activity);
    if (activity.startDate <= todayStr && endDate >= todayStr) return 'active';
    if (activity.startDate > todayStr) return 'upcoming';
    return 'ended';
  }

  function getAnomalyFlags(activity) {
    var flags = [];
    var types = Array.isArray(activity && activity.types) ? activity.types : [];

    if (types.length === 0 || types.indexOf(TYPE_UNCONFIGURED) !== -1) {
      flags.push('unconfigured');
    }

    if (!activity || !activity.startDate) {
      flags.push('missing_start');
    }

    if (activity && activity.startDate && !activity.endDate) {
      flags.push('missing_end');
    }

    if (!activity || !activity.eventId) {
      var isViewOnly = hasType(activity, TYPE_WEB) || hasType(activity, TYPE_OVERVIEW);
      if (!isViewOnly) flags.push('missing_event');
    }

    if (!hasRewards(activity)) {
      flags.push('missing_rewards');
    }

    return unique(flags);
  }

  function buildSearchText(activity) {
    var fields = [
      activity && activity.name,
      activity && activity.source,
      activity && activity.category,
      activity && activity.excelName,
      activity && activity.eventId,
      activity && activity.startDate,
      activity && activity.endDate,
    ];

    if (Array.isArray(activity && activity.types)) {
      fields = fields.concat(activity.types);
    }

    if (Array.isArray(activity && activity.rewards)) {
      activity.rewards.forEach(function (reward) {
        fields.push(reward && reward.name);
        fields.push(reward && reward.itemId);
      });
    }

    return fields
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function matchesFilters(activity, filters, todayStr) {
    var applied = filters || {};

    if (applied.search) {
      var query = String(applied.search).trim().toLowerCase();
      if (query && buildSearchText(activity).indexOf(query) === -1) return false;
    }

    if (applied.status && applied.status !== 'all') {
      if (getStatusKey(activity, todayStr) !== applied.status) return false;
    }

    if (applied.source && applied.source !== 'all') {
      if (String((activity && activity.source) || '') !== applied.source) return false;
    }

    if (applied.rewards === 'has' && !hasRewards(activity)) return false;
    if (applied.rewards === 'missing' && hasRewards(activity)) return false;

    if (applied.anomaly && applied.anomaly !== 'all') {
      var flags = getAnomalyFlags(activity);
      if (applied.anomaly === 'only') {
        if (flags.length === 0) return false;
      } else if (flags.indexOf(applied.anomaly) === -1) {
        return false;
      }
    }

    return true;
  }

  function filterActivities(activities, filters, todayStr) {
    return (activities || []).filter(function (activity) {
      return matchesFilters(activity, filters, todayStr);
    });
  }

  function listSources(activities) {
    return unique((activities || []).map(function (activity) {
      return String((activity && activity.source) || '').trim();
    }).filter(Boolean)).sort(function (a, b) {
      return a.localeCompare(b, 'zh-CN');
    });
  }

  function countByAnomaly(activities) {
    var counts = {
      all: 0,
      unconfigured: 0,
      missing_event: 0,
      missing_start: 0,
      missing_end: 0,
      missing_rewards: 0,
    };

    (activities || []).forEach(function (activity) {
      var flags = getAnomalyFlags(activity);
      if (flags.length > 0) counts.all += 1;
      flags.forEach(function (flag) {
        counts[flag] = (counts[flag] || 0) + 1;
      });
    });

    return counts;
  }

  function buildUpcomingGroups(activities, rangeDays, todayStr) {
    var today = parseDate(todayStr);
    if (!today) return [];

    var horizon = dateKey(addDays(today, rangeDays));
    var grouped = {};

    (activities || [])
      .filter(function (activity) {
        return activity && activity.startDate && activity.startDate > todayStr && activity.startDate <= horizon;
      })
      .sort(function (a, b) {
        var diff = compareDateStr(a.startDate, b.startDate);
        if (diff !== 0) return diff;
        return compareDateStr(getEndDate(a), getEndDate(b));
      })
      .forEach(function (activity) {
        if (!grouped[activity.startDate]) grouped[activity.startDate] = [];
        grouped[activity.startDate].push(activity);
      });

    return Object.keys(grouped).sort(compareDateStr).map(function (dateStr) {
      return {
        date: dateStr,
        items: grouped[dateStr],
      };
    });
  }

  function overlapsRange(activity, startStr, endStr) {
    if (!activity || !activity.startDate) return false;
    return activity.startDate <= endStr && getEndDate(activity) >= startStr;
  }

  function getDurationDays(activity) {
    if (!activity || !activity.startDate) return null;
    var start = parseDate(activity.startDate);
    var end = parseDate(getEndDate(activity));
    if (!start || !end) return null;
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  }

  function toPercent(part, total) {
    if (!total) return 0;
    return Math.round(part / total * 100);
  }

  function buildBreakdownEntries(map, total) {
    return Object.keys(map).map(function (key) {
      var count = map[key];
      return {
        key: key,
        label: key,
        count: count,
        pct: toPercent(count, total),
      };
    }).sort(function (a, b) {
      if (a.count !== b.count) return b.count - a.count;
      return a.label.localeCompare(b.label, 'zh-CN');
    });
  }

  function buildOperationsStats(activities, todayStr) {
    var list = (activities || []).slice();
    var total = list.length;
    var today = parseDate(todayStr);
    if (!today) {
      return {
        total: total,
        statusCounts: { active: 0, upcoming: 0, ended: 0, undated: 0 },
        cadence: { today: 0, thisWeek: 0, thisMonth: 0, next7: 0, next14: 0, next30: 0 },
        coverage: {
          rewards: { withCount: 0, withoutCount: total, pct: 0 },
          event: { withCount: 0, withoutCount: total, pct: 0 },
          typing: { configuredCount: 0, unconfiguredCount: total, pct: 0 },
        },
        durations: { averageDays: 0, medianDays: 0, longest: null, shortest: null },
        anomalies: countByAnomaly(list),
        breakdowns: { types: [], sources: [], status: [] },
      };
    }

    var weekStart = startOfWeek(today);
    var weekEnd = endOfWeek(today);
    var monthStart = startOfMonth(today);
    var monthEnd = endOfMonth(today);
    var next7 = dateKey(addDays(today, 7));
    var next14 = dateKey(addDays(today, 14));
    var next30 = dateKey(addDays(today, 30));
    var todayKeyStr = dateKey(today);

    var statusCounts = { active: 0, upcoming: 0, ended: 0, undated: 0 };
    var typeMap = {};
    var sourceMap = {};
    var durations = [];
    var rewardCount = 0;
    var eventCount = 0;
    var configuredCount = 0;
    var scheduleCompleteCount = 0;
    var longest = null;
    var shortest = null;

    list.forEach(function (activity) {
      var status = getStatusKey(activity, todayKeyStr);
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      var firstType = Array.isArray(activity.types) && activity.types.length > 0
        ? activity.types[0]
        : TYPE_UNCONFIGURED;
      typeMap[firstType] = (typeMap[firstType] || 0) + 1;

      var source = String((activity && activity.source) || '未知来源').trim() || '未知来源';
      sourceMap[source] = (sourceMap[source] || 0) + 1;

      if (hasRewards(activity)) rewardCount += 1;
      if (activity && activity.eventId) eventCount += 1;
      if (!hasType(activity, TYPE_UNCONFIGURED)) configuredCount += 1;
      if (activity && activity.startDate && activity.endDate) scheduleCompleteCount += 1;

      var duration = getDurationDays(activity);
      if (duration != null) {
        durations.push({ activity: activity, days: duration });
        if (!longest || duration > longest.days) longest = { activity: activity, days: duration };
        if (!shortest || duration < shortest.days) shortest = { activity: activity, days: duration };
      }
    });

    var sortedDays = durations.map(function (item) { return item.days; }).sort(function (a, b) { return a - b; });
    var averageDays = sortedDays.length
      ? Math.round((sortedDays.reduce(function (sum, item) { return sum + item; }, 0) / sortedDays.length) * 10) / 10
      : 0;
    var medianDays = 0;
    if (sortedDays.length > 0) {
      var middle = Math.floor(sortedDays.length / 2);
      medianDays = sortedDays.length % 2 === 0
        ? (sortedDays[middle - 1] + sortedDays[middle]) / 2
        : sortedDays[middle];
    }

    var cadence = {
      today: list.filter(function (activity) {
        return overlapsRange(activity, todayKeyStr, todayKeyStr);
      }).length,
      thisWeek: list.filter(function (activity) {
        return overlapsRange(activity, dateKey(weekStart), dateKey(weekEnd));
      }).length,
      thisMonth: list.filter(function (activity) {
        return overlapsRange(activity, dateKey(monthStart), dateKey(monthEnd));
      }).length,
      next7: list.filter(function (activity) {
        return activity && activity.startDate && activity.startDate > todayKeyStr && activity.startDate <= next7;
      }).length,
      next14: list.filter(function (activity) {
        return activity && activity.startDate && activity.startDate > todayKeyStr && activity.startDate <= next14;
      }).length,
      next30: list.filter(function (activity) {
        return activity && activity.startDate && activity.startDate > todayKeyStr && activity.startDate <= next30;
      }).length,
    };

    return {
      total: total,
      scheduledCount: list.filter(function (activity) { return !!(activity && activity.startDate); }).length,
      scheduleCompleteCount: scheduleCompleteCount,
      statusCounts: statusCounts,
      cadence: cadence,
      coverage: {
        rewards: {
          withCount: rewardCount,
          withoutCount: total - rewardCount,
          pct: toPercent(rewardCount, total),
        },
        event: {
          withCount: eventCount,
          withoutCount: total - eventCount,
          pct: toPercent(eventCount, total),
        },
        typing: {
          configuredCount: configuredCount,
          unconfiguredCount: total - configuredCount,
          pct: toPercent(configuredCount, total),
        },
        schedule: {
          completeCount: scheduleCompleteCount,
          incompleteCount: total - scheduleCompleteCount,
          pct: toPercent(scheduleCompleteCount, total),
        },
      },
      durations: {
        averageDays: averageDays,
        medianDays: medianDays,
        longest: longest,
        shortest: shortest,
      },
      anomalies: countByAnomaly(list),
      breakdowns: {
        types: buildBreakdownEntries(typeMap, total),
        sources: buildBreakdownEntries(sourceMap, total),
        status: buildBreakdownEntries({
          '进行中': statusCounts.active,
          '即将开始': statusCounts.upcoming,
          '已结束': statusCounts.ended,
          '未排期': statusCounts.undated,
        }, total),
      },
    };
  }

  function summarizeOperations(stats) {
    if (!stats || !stats.total) {
      return ['当前筛选范围内没有活动数据，暂时无法生成运营摘要。'];
    }

    var lines = [];
    var topType = stats.breakdowns.types[0];
    var topSource = stats.breakdowns.sources[0];

    lines.push(
      '当前共有 ' + stats.total + ' 个活动，其中 ' + stats.statusCounts.active + ' 个进行中，' +
      stats.cadence.next14 + ' 个将在未来 14 天内开始。'
    );

    lines.push(
      '奖励覆盖率 ' + stats.coverage.rewards.pct + '%，Event 绑定率 ' + stats.coverage.event.pct +
      '%，类型配置完成率 ' + stats.coverage.typing.pct + '%。'
    );

    if (stats.anomalies.all > 0) {
      lines.push(
        '当前仍有 ' + stats.anomalies.all + ' 个异常活动待处理，其中未配置类型 ' +
        stats.anomalies.unconfigured + ' 个、未绑定 Event ' + stats.anomalies.missing_event + ' 个。'
      );
    } else {
      lines.push('当前筛选范围内没有异常活动，配置质量较稳定。');
    }

    if (topType) {
      lines.push(
        '活动类型以“' + topType.label + '”为主，占比 ' + topType.pct + '%。'
      );
    }

    if (topSource) {
      lines.push(
        '来源最多的是“' + topSource.label + '”，共 ' + topSource.count + ' 个活动。'
      );
    }

    if (stats.durations.longest) {
      lines.push(
        '当前跨度最长的活动是“' + ((stats.durations.longest.activity && stats.durations.longest.activity.name) || '未命名活动') +
        '”，持续 ' + stats.durations.longest.days + ' 天。'
      );
    }

    return lines;
  }

  function groupByStableKey(activities) {
    var grouped = {};
    (activities || []).forEach(function (activity) {
      var key = getStableActivityKey(activity);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(activity);
    });
    Object.keys(grouped).forEach(function (key) {
      grouped[key] = grouped[key].slice().sort(function (a, b) {
        var diff = compareDateStr(a && a.startDate, b && b.startDate);
        if (diff !== 0) return diff;
        return compareDateStr(getEndDate(a), getEndDate(b));
      });
    });
    return grouped;
  }

  function getRewardSignature(activity) {
    if (!Array.isArray(activity && activity.rewards) || activity.rewards.length === 0) return '';
    return activity.rewards.map(function (reward) {
      return [(reward && reward.name) || '', (reward && reward.itemId) || ''].join('#');
    }).sort().join('|');
  }

  function pushChange(summary, entries, stableKeys, type, activity, before) {
    summary[type] = (summary[type] || 0) + 1;
    entries.push({
      type: type,
      stableKey: getStableActivityKey(activity || before),
      activity: activity || null,
      before: before || null,
      label: (activity && activity.name) || (before && before.name) || '未命名活动',
    });
    if (type !== 'removed') {
      stableKeys[getStableActivityKey(activity || before)] = true;
    }
  }

  function diffActivityLists(previousActivities, nextActivities) {
    var previous = groupByStableKey(previousActivities || []);
    var next = groupByStableKey(nextActivities || []);
    var allKeys = unique(Object.keys(previous).concat(Object.keys(next)));
    var entries = [];
    var stableKeys = {};
    var summary = {
      added: 0,
      removed: 0,
      date_changed: 0,
      type_changed: 0,
      reward_changed: 0,
    };

    allKeys.forEach(function (key) {
      var prevList = previous[key] || [];
      var nextList = next[key] || [];
      var maxLength = Math.max(prevList.length, nextList.length);

      for (var index = 0; index < maxLength; index += 1) {
        var before = prevList[index];
        var after = nextList[index];

        if (!before && after) {
          pushChange(summary, entries, stableKeys, 'added', after, null);
          continue;
        }

        if (before && !after) {
          pushChange(summary, entries, stableKeys, 'removed', null, before);
          continue;
        }

        if (!before || !after) continue;

        if ((before.startDate || '') !== (after.startDate || '') || getEndDate(before) !== getEndDate(after)) {
          pushChange(summary, entries, stableKeys, 'date_changed', after, before);
        }

        var beforeTypes = Array.isArray(before.types) ? before.types.join('|') : '';
        var afterTypes = Array.isArray(after.types) ? after.types.join('|') : '';
        if (beforeTypes !== afterTypes) {
          pushChange(summary, entries, stableKeys, 'type_changed', after, before);
        }

        if (getRewardSignature(before) !== getRewardSignature(after)) {
          pushChange(summary, entries, stableKeys, 'reward_changed', after, before);
        }
      }
    });

    summary.total = summary.added + summary.removed + summary.date_changed + summary.type_changed + summary.reward_changed;

    return {
      summary: summary,
      entries: entries,
      changedStableKeys: Object.keys(stableKeys),
    };
  }

  return {
    ANOMALY_LABELS: ANOMALY_LABELS,
    addDays: addDays,
    buildOperationsStats: buildOperationsStats,
    buildUpcomingGroups: buildUpcomingGroups,
    countByAnomaly: countByAnomaly,
    dateKey: dateKey,
    diffActivityLists: diffActivityLists,
    endOfMonth: endOfMonth,
    endOfWeek: endOfWeek,
    filterActivities: filterActivities,
    getAnomalyFlags: getAnomalyFlags,
    getDurationDays: getDurationDays,
    getEndDate: getEndDate,
    getStableActivityKey: getStableActivityKey,
    getStatusKey: getStatusKey,
    hasRewards: hasRewards,
    listSources: listSources,
    matchesFilters: matchesFilters,
    overlapsRange: overlapsRange,
    parseDate: parseDate,
    startOfMonth: startOfMonth,
    startOfWeek: startOfWeek,
    summarizeOperations: summarizeOperations,
    toPercent: toPercent,
  };
});
