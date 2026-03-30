(function () {
  'use strict';

  var statusEl     = document.getElementById('status');
  var statusLabel  = statusEl.querySelector('.label');
  var tabsEl       = document.getElementById('tabs');
  var calendarView = document.getElementById('calendar-view');
  var configView   = document.getElementById('config-check-view');
  var updateTimeEl = document.getElementById('update-time');
  var themeToggle  = document.getElementById('theme-toggle');

  var activeTab = '__calendar__';
  var activeTypeFilter = 'all';

  var calendarActivities = [];
  var calYear, calMonth;
  var selectedDate = null;

  var COLORS = [
    '#818cf8', '#34d399', '#fbbf24', '#f87171', '#67e8f9',
    '#e879f9', '#2dd4bf', '#fb923c', '#60a5fa', '#a3e635',
    '#f472b6', '#22d3ee', '#facc15', '#a78bfa', '#4ade80',
    '#fb7185', '#7dd3fc', '#c084fc', '#86efac', '#f87171',
  ];
  var activityColorMap = {};
  var colorIndex = 0;

  // -------- Theme Toggle --------

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gng-theme', theme);
    themeToggle.innerHTML = theme === 'light' ? '&#x2728;' : '&#9790;';
  }

  themeToggle.innerHTML = getTheme() === 'light' ? '&#x2728;' : '&#9790;';

  themeToggle.addEventListener('click', function () {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });

  // -------- Changelog Modal --------

  var changelogOverlay = document.getElementById('changelog-overlay');
  var versionBtn = document.getElementById('version-btn');
  var changelogClose = document.getElementById('changelog-close');

  versionBtn.addEventListener('click', function () {
    changelogOverlay.classList.add('open');
  });

  changelogClose.addEventListener('click', function () {
    changelogOverlay.classList.remove('open');
  });

  changelogOverlay.addEventListener('click', function (e) {
    if (e.target === changelogOverlay) changelogOverlay.classList.remove('open');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && changelogOverlay.classList.contains('open')) {
      changelogOverlay.classList.remove('open');
    }
  });

  // -------- Socket.io --------

  var socket = io();

  socket.on('connect', function () { setStatus('connected', '已连接'); });
  socket.on('disconnect', function () { setStatus('disconnected', '已断开，重连中…'); });
  socket.on('sheet:update', function () { refreshCalendarData(); updateTimestamp(); });

  // -------- Initial load --------

  renderTabs();
  renderTypeFilterBar();
  initEventUploadPanel();

  fetch('/api/calendar')
    .then(function (res) { return res.json(); })
    .then(function (json) {
      if (json.activities) {
        calendarActivities = json.activities;
        assignColors();
        renderActiveNow();
        renderCalendar();
        renderTypeFilterBar();
        updateTimestamp();
      }
    })
    .catch(function (err) { console.error('Failed to fetch calendar data:', err); });

  // -------- Data refresh --------

  function refreshCalendarData() {
    fetch('/api/calendar')
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (json.activities) {
          calendarActivities = json.activities;
          assignColors();
          if (activeTab === '__calendar__') {
            renderActiveNow();
            renderCalendar();
            renderTypeFilterBar();
          }
        }
      });
  }

  // -------- Event Upload --------

  function initEventUploadPanel() {
    var form = document.getElementById('event-upload-form');
    if (!form) return;
    var fileInput = document.getElementById('event-file-input');
    var status = document.getElementById('event-upload-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!fileInput.files || fileInput.files.length === 0) {
        status.textContent = '请先选择 Event.xlsx 文件';
        status.className = 'upload-status error';
        return;
      }

      var file = fileInput.files[0];
      if (!/\.xlsx$/i.test(file.name)) {
        status.textContent = '仅支持上传 .xlsx 文件';
        status.className = 'upload-status error';
        return;
      }

      var fd = new FormData();
      fd.append('eventFile', file);
      submitBtn.disabled = true;
      status.textContent = '上传中，请稍候...';
      status.className = 'upload-status';

      fetch('/api/event-upload', { method: 'POST', body: fd })
        .then(function (res) {
          return res.json().then(function (json) {
            if (!res.ok) throw new Error(json.error || '上传失败');
            return json;
          });
        })
        .then(function (json) {
          status.textContent = (json.message || '上传成功') + '（活动数：' + (json.activities || 0) + '）';
          status.className = 'upload-status success';
          form.reset();
          refreshCalendarData();
          updateTimestamp();
        })
        .catch(function (err) {
          status.textContent = err.message || '上传失败';
          status.className = 'upload-status error';
        })
        .finally(function () {
          submitBtn.disabled = false;
        });
    });
  }

  // -------- Tabs --------

  function renderTabs() {
    tabsEl.innerHTML = '';

    var calBtn = document.createElement('button');
    calBtn.className = 'tab tab-calendar' + (activeTab === '__calendar__' ? ' active' : '');
    calBtn.textContent = '活动日历';
    calBtn.addEventListener('click', function () {
      activeTab = '__calendar__'; setActiveTab(); switchView(); renderCalendar();
    });
    tabsEl.appendChild(calBtn);

    var cfgBtn = document.createElement('button');
    cfgBtn.className = 'tab tab-config' + (activeTab === '__config__' ? ' active' : '');
    cfgBtn.textContent = '配置检查';
    cfgBtn.addEventListener('click', function () {
      activeTab = '__config__'; setActiveTab(); switchView();
    });
    tabsEl.appendChild(cfgBtn);
  }

  function setActiveTab() {
    var btns = tabsEl.querySelectorAll('.tab');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var match =
        (activeTab === '__calendar__' && btn.classList.contains('tab-calendar')) ||
        (activeTab === '__config__' && btn.classList.contains('tab-config'));
      btn.classList.toggle('active', match);
    }
  }

  function switchView() {
    calendarView.style.display = activeTab === '__calendar__' ? '' : 'none';
    configView.style.display   = activeTab === '__config__'   ? '' : 'none';
  }

  // -------- Type Helpers --------

  var TYPE_CSS = {
    '任务活动': 'type-tag-task', '抽奖活动': 'type-tag-gacha',
    '兑换活动': 'type-tag-redeem', '新抽奖': 'type-tag-bravo',
    '仅说明页活动': 'type-tag-overview', '网页活动': 'type-tag-web',
    '其他活动': 'type-tag-other', '未配置': 'type-tag-unconf',
  };

  var TYPE_FILTER_KEY = {
    '任务活动': 'task', '抽奖活动': 'gacha', '兑换活动': 'redeem', '新抽奖': 'bravo',
    '仅说明页活动': 'overview', '网页活动': 'web', '其他活动': 'other', '未配置': 'unconf',
  };

  var TYPE_LABEL = {};
  Object.keys(TYPE_FILTER_KEY).forEach(function (k) { TYPE_LABEL[TYPE_FILTER_KEY[k]] = k; });

  function renderTypeTags(types) {
    if (!types || types.length === 0) return '';
    var html = '';
    types.forEach(function (t) {
      var cls = TYPE_CSS[t] || '';
      html += '<span class="type-tag ' + cls + '">' + escapeHtml(t) + '</span>';
    });
    return html;
  }

  function getTypeCounts() {
    var counts = { all: calendarActivities.length };
    calendarActivities.forEach(function (a) {
      if (!a.types) return;
      a.types.forEach(function (t) {
        var key = TYPE_FILTER_KEY[t];
        if (key) counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  function renderTypeFilterBar() {
    var bar = document.getElementById('type-filter-bar');
    var counts = getTypeCounts();
    var filters = [
      { key: 'all', label: '全部' }, { key: 'task', label: '任务活动' },
      { key: 'gacha', label: '抽奖活动' }, { key: 'redeem', label: '兑换活动' },
      { key: 'bravo', label: '新抽奖' }, { key: 'overview', label: '仅说明页' },
      { key: 'web', label: '网页活动' }, { key: 'other', label: '其他活动' },
      { key: 'unconf', label: '未配置' },
    ];
    var html = '';
    filters.forEach(function (f) {
      var act = activeTypeFilter === f.key ? ' active' : '';
      var count = counts[f.key] || 0;
      if (f.key !== 'all' && count === 0) return;
      html += '<button class="type-filter-btn' + act + '" data-type="' + f.key + '">';
      html += f.label;
      if (count > 0) html += '<span class="filter-count">' + count + '</span>';
      html += '</button>';
    });
    bar.innerHTML = html;
    bar.onclick = function (e) {
      var btn = e.target.closest('.type-filter-btn');
      if (!btn) return;
      activeTypeFilter = btn.getAttribute('data-type');
      renderTypeFilterBar();
      renderCalendar();
    };
  }

  function filterByType(activities) {
    if (activeTypeFilter === 'all') return activities;
    return activities.filter(function (a) {
      if (!a.types) return false;
      return a.types.some(function (t) { return TYPE_FILTER_KEY[t] === activeTypeFilter; });
    });
  }

  // -------- Colors --------

  function assignColors() {
    calendarActivities.forEach(function (a) {
      if (!activityColorMap[a.name]) {
        activityColorMap[a.name] = COLORS[colorIndex % COLORS.length];
        colorIndex++;
      }
    });
  }

  function getColor(name) { return activityColorMap[name] || '#999'; }

  function activityIdentityKey(a) {
    return [
      (a && a.name) || '',
      (a && a.startDate) || '',
      (a && a.endDate) || '',
      (a && a.source) || '',
      (a && a.category) || '',
    ].join('|');
  }

  function buildPeriodIndexMap(activities) {
    var byName = {};
    (activities || []).forEach(function (a) {
      var name = (a && a.name) || '';
      if (!name) return;
      if (!byName[name]) byName[name] = [];
      byName[name].push(a);
    });

    var map = {};
    Object.keys(byName).forEach(function (name) {
      var list = byName[name].slice().sort(function (x, y) {
        var xs = (x.startDate || '9999-99-99');
        var ys = (y.startDate || '9999-99-99');
        if (xs !== ys) return xs.localeCompare(ys);
        var xe = (x.endDate || x.startDate || '9999-99-99');
        var ye = (y.endDate || y.startDate || '9999-99-99');
        return xe.localeCompare(ye);
      });
      if (list.length <= 1) return;
      list.forEach(function (a, i) {
        map[activityIdentityKey(a)] = i + 1;
      });
    });

    return map;
  }

  function getDisplayName(a, periodMap) {
    var base = (a && a.name) || '';
    var idx = periodMap ? periodMap[activityIdentityKey(a)] : null;
    return idx ? (base + '（第' + idx + '期）') : base;
  }

  // -------- Active Now --------

  function renderActiveNow() {
    var container = document.getElementById('active-now');
    var todayStr = (function () {
      var now = new Date();
      return fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    })();

    var active = calendarActivities.filter(function (a) {
      if (!a.startDate) return false;
      var end = a.endDate || a.startDate;
      if (!(a.startDate <= todayStr && end >= todayStr)) return false;
      if (!a.types || a.types.length === 0) return false;
      return !a.types.some(function (t) { return t === '未配置'; });
    });

    if (active.length === 0) { container.innerHTML = ''; return; }

    var todayMs = new Date().setHours(0, 0, 0, 0);
    var periodMap = buildPeriodIndexMap(calendarActivities);

    var html = '<div class="active-now-header">';
    html += '<span class="active-now-pulse"></span>';
    html += '正在进行';
    html += '<span class="active-now-count">' + active.length + '个活动进行中</span>';
    html += '</div>';

    html += '<div class="active-now-scroll">';

    active.forEach(function (a) {
      var c = getColor(a.name);
      var startMs = parseDateParts(a.startDate).getTime();
      var endMs = parseDateParts(a.endDate || a.startDate).getTime();
      var totalDays = Math.max(Math.round((endMs - startMs) / 86400000), 1);
      var elapsed = Math.max(Math.round((todayMs - startMs) / 86400000), 0);
      var remaining = Math.max(Math.round((endMs - todayMs) / 86400000), 0);
      var pct = Math.min(Math.round(elapsed / totalDays * 100), 100);

      var firstType = (a.types && a.types.length > 0) ? a.types[0] : '';
      var tagCls = TYPE_CSS[firstType] || '';

      html += '<div class="active-now-card" style="--card-color:' + c + '">';
      html += '<div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:' + c + ';border-radius:3px 0 0 3px"></div>';

      html += '<div class="active-now-card-top">';
      html += '<span class="active-now-dot" style="background:' + c + ';color:' + c + '"></span>';
      html += '<span class="active-now-name" title="' + escapeAttr(getDisplayName(a, periodMap)) + '">' + escapeHtml(getDisplayName(a, periodMap)) + '</span>';
      html += '</div>';

      html += '<div class="active-now-card-mid">';
      if (firstType) {
        html += '<span class="type-tag ' + tagCls + '">' + escapeHtml(firstType) + '</span>';
      }
      html += '<span class="active-now-remaining">';
      if (remaining === 0) {
        html += '今天结束';
      } else {
        html += '剩余' + remaining + '天';
      }
      html += '</span>';
      html += '</div>';

      html += '<div class="active-now-progress">';
      html += '<div class="active-now-progress-fill" style="width:' + pct + '%;background:' + c + '"></div>';
      html += '</div>';

      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // -------- Calendar --------

  function initCalendarMonth() {
    if (calYear != null) return;
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }

  function renderCalendar() {
    initCalendarMonth();

    document.getElementById('cal-title').textContent = calYear + '年' + (calMonth + 1) + '月';

    document.getElementById('cal-prev').onclick = function () {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      selectedDate = null; renderCalendar();
    };
    document.getElementById('cal-next').onclick = function () {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      selectedDate = null; renderCalendar();
    };
    document.getElementById('cal-today').onclick = function () {
      var now = new Date();
      calYear = now.getFullYear(); calMonth = now.getMonth();
      selectedDate = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
      renderCalendar();
    };

    var today = new Date();
    var todayStr = fmtDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
    var firstDay = new Date(calYear, calMonth, 1);
    var lastDay = new Date(calYear, calMonth + 1, 0);
    var startDow = (firstDay.getDay() + 6) % 7;
    var daysInMonth = lastDay.getDate();
    var monthStart = fmtDate(calYear, calMonth + 1, 1);
    var monthEnd = fmtDate(calYear, calMonth + 1, daysInMonth);

    var monthActivities = filterByType(calendarActivities.filter(function (a) {
      if (!a.startDate) return false;
      var e = a.endDate || a.startDate;
      return a.startDate <= monthEnd && e >= monthStart;
    }));
    var globalPeriodMap = buildPeriodIndexMap(calendarActivities);

    if (!selectedDate) selectedDate = todayStr;
    var selParts = selectedDate.split('-');
    var selInMonth = parseInt(selParts[0]) === calYear && parseInt(selParts[1]) === calMonth + 1;
    if (!selInMonth) {
      selectedDate = monthStart;
    }

    renderMiniCalendar(daysInMonth, startDow, todayStr, monthActivities, globalPeriodMap);
    renderSidebar(monthActivities, globalPeriodMap);
    renderSwimlaneTimeline(monthActivities, daysInMonth, globalPeriodMap);
    renderActivityCards(monthActivities, document.getElementById('activity-detail'), globalPeriodMap);
  }

  // -------- Mini Calendar --------

  function renderMiniCalendar(daysInMonth, startDow, todayStr, monthActivities, periodMap) {
    var bodyEl = document.getElementById('calendar-body');
    var html = '<div class="mini-cal-panel"><div class="mini-cal-grid">';

    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (d) {
      html += '<div class="mini-cal-weekday">' + d + '</div>';
    });

    for (var i = 0; i < startDow; i++) {
      html += '<div class="mini-cal-day mini-cal-empty"></div>';
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = fmtDate(calYear, calMonth + 1, day);
      var acts = getActivitiesForDate(monthActivities, dateStr);
      var cls = 'mini-cal-day';
      if (dateStr === todayStr) cls += ' today';
      if (dateStr === selectedDate) cls += ' selected';
      if (acts.length > 0) cls += ' has-events';

      html += '<div class="' + cls + '" data-date="' + dateStr + '">' + day + '</div>';
    }

    html += '</div></div>';
    html += '<div class="sidebar-panel" id="sidebar-panel"></div>';

    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.mini-cal-day:not(.mini-cal-empty)').forEach(function (cell) {
      cell.addEventListener('click', function () {
        selectedDate = cell.getAttribute('data-date');
        bodyEl.querySelectorAll('.mini-cal-day').forEach(function (c) {
          c.classList.toggle('selected', c.getAttribute('data-date') === selectedDate);
        });
        renderSidebar(monthActivities, periodMap);
      });
    });
  }

  // -------- Sidebar --------

  function renderSidebar(monthActivities, periodMap) {
    var panel = document.getElementById('sidebar-panel');
    if (!panel) return;

    var parts = selectedDate.split('-');
    var label = parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';
    var acts = getActivitiesForDate(monthActivities, selectedDate);

    var html = '<div class="sidebar-title">' + label;
    html += '<span class="sidebar-count">' + acts.length + '个活动</span></div>';

    if (acts.length === 0) {
      html += '<div class="sidebar-empty">当天无活动</div>';
    } else {
      html += '<div class="sidebar-list">';
      acts.forEach(function (a) {
        var displayName = getDisplayName(a, periodMap);
        var activityKey = activityIdentityKey(a);
        var c = getColor(a.name);
        html += '<div class="sidebar-item" data-key="' + escapeAttr(activityKey) + '">';
        html += '<span class="sidebar-dot" style="background:' + c + ';color:' + c + '"></span>';
        html += '<div class="sidebar-info">';
        html += '<div class="sidebar-name">' + escapeHtml(displayName) + '</div>';
        html += '<div class="sidebar-date">' + escapeHtml(a.startDate || '未定') + ' ~ ' + escapeHtml(a.endDate || '未定') + '</div>';
        html += '</div>';
        if (a.types && a.types.length > 0) {
          html += '<div class="sidebar-tags">' + renderTypeTags(a.types) + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    panel.innerHTML = html;

    panel.querySelectorAll('.sidebar-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var key = item.getAttribute('data-key');
        var card = document.querySelector('.activity-card[data-key="' + key + '"]');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('highlight');
          setTimeout(function () { card.classList.remove('highlight'); }, 2000);
        }
      });
    });
  }

  // -------- Swimlane Timeline --------

  function renderSwimlaneTimeline(monthActivities, daysInMonth, periodMap) {
    var section = document.getElementById('timeline-section');
    if (monthActivities.length === 0) { section.innerHTML = ''; return; }

    var groups = {};
    var groupOrder = ['task', 'gacha', 'redeem', 'bravo', 'overview', 'web', 'other', 'unconf'];
    var groupLabels = {
      task: '任务活动', gacha: '抽奖活动', redeem: '兑换活动', bravo: '新抽奖',
      overview: '仅说明页活动', web: '网页活动', other: '其他活动', unconf: '未配置',
    };

    monthActivities.forEach(function (a) {
      var key = 'unconf';
      if (a.types && a.types.length > 0) {
        var fk = TYPE_FILTER_KEY[a.types[0]];
        if (fk) key = fk;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });

    var monthStartDate = new Date(calYear, calMonth, 1);

    var html = '<div class="timeline-header">活动时间线</div>';

    groupOrder.forEach(function (gk) {
      if (!groups[gk] || groups[gk].length === 0) return;

      html += '<div class="swimlane-group">';
      html += '<div class="swimlane-group-title">' + groupLabels[gk] + '</div>';

      groups[gk].forEach(function (a) {
        var c = getColor(a.name);
        var aStart = a.startDate || fmtDate(calYear, calMonth + 1, 1);
        var aEnd = a.endDate || a.startDate || fmtDate(calYear, calMonth + 1, daysInMonth);

        var sd = parseDateParts(aStart);
        var ed = parseDateParts(aEnd);
        var msStart = new Date(calYear, calMonth, 1);
        var msEnd = new Date(calYear, calMonth + 1, 0);

        var clampedStart = new Date(Math.max(sd.getTime(), msStart.getTime()));
        var clampedEnd = new Date(Math.min(ed.getTime(), msEnd.getTime()));

        var dayStart = clampedStart.getDate();
        var dayEnd = clampedEnd.getDate();

        var leftPct = ((dayStart - 1) / daysInMonth * 100).toFixed(1);
        var widthPct = ((dayEnd - dayStart + 1) / daysInMonth * 100).toFixed(1);
        if (parseFloat(widthPct) < 3) widthPct = '3';

        var firstType = (a.types && a.types.length > 0) ? a.types[0] : '';
        var tagCls = TYPE_CSS[firstType] || '';

        var barLabel = '';
        if (parseFloat(widthPct) > 12) {
          barLabel = (aStart.slice(5) + ' — ' + aEnd.slice(5)).replace(/-/g, '/');
        }

        html += '<div class="swimlane-row">';
        html += '<span class="swimlane-name" title="' + escapeAttr(getDisplayName(a, periodMap)) + '">' + escapeHtml(getDisplayName(a, periodMap)) + '</span>';
        if (firstType) {
          html += '<span class="swimlane-tag type-tag ' + tagCls + '">' + escapeHtml(firstType) + '</span>';
        }
        html += '<div class="swimlane-bar-track">';
        html += '<div class="swimlane-bar" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + c + ';--bar-c:' + c + '">' + barLabel + '</div>';
        html += '</div>';
        html += '<span class="swimlane-dates">' + escapeHtml(aStart) + ' ~ ' + escapeHtml(aEnd) + '</span>';
        html += '</div>';
      });

      html += '</div>';
    });

    section.innerHTML = html;
  }

  function parseDateParts(dateStr) {
    var p = dateStr.split('-');
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  }

  // -------- Activity Cards --------

  function renderActivityCards(monthActivities, detailEl, periodMap) {
    if (monthActivities.length === 0) {
      detailEl.innerHTML = '<p class="no-activities">本月暂无已排期的活动</p>';
      return;
    }

    var html = '<h3 class="detail-title">本月活动（' + monthActivities.length + '）</h3>';
    html += '<div class="activity-list">';

    monthActivities.forEach(function (a) {
      var displayName = getDisplayName(a, periodMap);
      var activityKey = activityIdentityKey(a);
      var c = getColor(a.name);
      html += '<div class="activity-card" data-key="' + escapeAttr(activityKey) + '">';
      html += '<div class="activity-card-header">';
      html += '<span class="activity-dot" style="background:' + c + ';color:' + c + '"></span>';
      html += '<strong>' + escapeHtml(displayName) + '</strong>';
      html += '<span class="activity-source">' + escapeHtml(a.source) + '</span>';
      html += '</div>';
      if (a.types && a.types.length > 0) {
        html += '<div class="type-tags">' + renderTypeTags(a.types) + '</div>';
      }
      html += '<div class="activity-dates">' +
        escapeHtml(a.startDate || '未定') + ' ~ ' + escapeHtml(a.endDate || '未定') + '</div>';
      if (a.rewards && a.rewards.length > 0) {
        html += '<div class="activity-rewards"><span class="rewards-label">奖励：</span>';
        a.rewards.forEach(function (rw) {
          html += '<span class="reward-tag">' + escapeHtml(rw.name);
          if (rw.itemId) html += '<code>' + rw.itemId + '</code>';
          html += '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });

    html += '</div>';
    detailEl.innerHTML = html;
  }

  // -------- Helpers --------

  function getActivitiesForDate(acts, dateStr) {
    return acts.filter(function (a) {
      var e = a.endDate || a.startDate;
      return a.startDate && a.startDate <= dateStr && e >= dateStr;
    });
  }

  function fmtDate(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function setStatus(state, text) {
    statusEl.className = 'status ' + state;
    statusLabel.textContent = text;
  }

  function updateTimestamp() {
    var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    updateTimeEl.textContent = '最近更新：' + t;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }
})();
