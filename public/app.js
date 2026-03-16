(function () {
  'use strict';

  var statusEl     = document.getElementById('status');
  var statusLabel  = statusEl.querySelector('.label');
  var tabsEl       = document.getElementById('tabs');
  var calendarView = document.getElementById('calendar-view');
  var configView   = document.getElementById('config-check-view');
  var updateTimeEl = document.getElementById('update-time');

  var activeTab = '__calendar__';

  var calendarActivities = [];
  var calYear, calMonth;
  var selectedDate = null;
  var popup = null;

  var COLORS = [
    '#6c5ce7', '#00e676', '#ffab40', '#ff5252', '#00e5ff',
    '#ea80fc', '#64ffda', '#ff6e40', '#448aff', '#b2ff59',
    '#ff4081', '#18ffff', '#ffd740', '#7c4dff', '#69f0ae',
    '#f06292', '#80d8ff', '#ce93d8', '#a5d6a7', '#ef5350',
  ];
  var activityColorMap = {};
  var colorIndex = 0;

  // -------- Socket.io --------

  var socket = io();

  socket.on('connect', function () {
    setStatus('connected', '已连接');
  });

  socket.on('disconnect', function () {
    setStatus('disconnected', '已断开，重连中…');
  });

  socket.on('sheet:update', function () {
    refreshCalendarData();
    updateTimestamp();
  });

  // -------- Initial load --------

  renderTabs();

  fetch('/api/calendar')
    .then(function (res) { return res.json(); })
    .then(function (json) {
      if (json.activities) {
        calendarActivities = json.activities;
        assignColors();
        renderCalendar();
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
          if (activeTab === '__calendar__') renderCalendar();
        }
      });
  }

  // -------- Tabs --------

  function renderTabs() {
    tabsEl.innerHTML = '';

    var calBtn = document.createElement('button');
    calBtn.className = 'tab tab-calendar' + (activeTab === '__calendar__' ? ' active' : '');
    calBtn.textContent = '活动日历';
    calBtn.addEventListener('click', function () {
      activeTab = '__calendar__';
      setActiveTab();
      switchView();
      renderCalendar();
    });
    tabsEl.appendChild(calBtn);

    var cfgBtn = document.createElement('button');
    cfgBtn.className = 'tab tab-config' + (activeTab === '__config__' ? ' active' : '');
    cfgBtn.textContent = '配置检查';
    cfgBtn.addEventListener('click', function () {
      activeTab = '__config__';
      setActiveTab();
      switchView();
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

  // -------- Calendar --------

  function assignColors() {
    calendarActivities.forEach(function (a) {
      if (!activityColorMap[a.name]) {
        activityColorMap[a.name] = COLORS[colorIndex % COLORS.length];
        colorIndex++;
      }
    });
  }

  function getColor(name) {
    return activityColorMap[name] || '#999';
  }

  function initCalendarMonth() {
    if (calYear != null) return;
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }

  function renderCalendar() {
    initCalendarMonth();
    closePopup();

    document.getElementById('cal-title').textContent =
      calYear + '年' + (calMonth + 1) + '月';

    document.getElementById('cal-prev').onclick = function () {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    };
    document.getElementById('cal-next').onclick = function () {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    };
    document.getElementById('cal-today').onclick = function () {
      var now = new Date();
      calYear = now.getFullYear();
      calMonth = now.getMonth();
      renderCalendar();
    };

    var grid = document.getElementById('calendar-grid');
    var detail = document.getElementById('activity-detail');
    detail.innerHTML = '';

    var firstDay = new Date(calYear, calMonth, 1);
    var lastDay = new Date(calYear, calMonth + 1, 0);
    var startDow = (firstDay.getDay() + 6) % 7;
    var daysInMonth = lastDay.getDate();

    var today = new Date();
    var todayStr = fmtDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

    var monthStart = fmtDate(calYear, calMonth + 1, 1);
    var monthEnd = fmtDate(calYear, calMonth + 1, daysInMonth);

    var monthActivities = calendarActivities.filter(function (a) {
      if (!a.startDate) return false;
      var e = a.endDate || a.startDate;
      return a.startDate <= monthEnd && e >= monthStart;
    });

    // -------- Calendar grid with dots --------
    var MAX_DOTS = 8;

    var html = '<div class="cal-row cal-weekdays">';
    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (d) {
      html += '<div class="cal-cell cal-weekday">' + d + '</div>';
    });
    html += '</div>';

    var day = 1;
    var rows = Math.ceil((startDow + daysInMonth) / 7);

    for (var r = 0; r < rows; r++) {
      html += '<div class="cal-row">';
      for (var col = 0; col < 7; col++) {
        var cellIdx = r * 7 + col;
        if (cellIdx < startDow || day > daysInMonth) {
          html += '<div class="cal-cell cal-empty"></div>';
        } else {
          var dateStr = fmtDate(calYear, calMonth + 1, day);
          var isToday = dateStr === todayStr;
          var isSel = dateStr === selectedDate;
          var dayActs = getActivitiesForDate(monthActivities, dateStr);
          var cls = 'cal-cell cal-day';
          if (isToday) cls += ' cal-today-cell';
          if (isSel) cls += ' cal-selected';

          html += '<div class="' + cls + '" data-date="' + dateStr + '">';
          html += '<span class="cal-day-num">' + day + '</span>';

          if (dayActs.length > 0) {
            html += '<div class="cal-dots">';
            var shown = Math.min(dayActs.length, MAX_DOTS);
            for (var di = 0; di < shown; di++) {
              var c = getColor(dayActs[di].name);
              html += '<span class="cal-dot" style="background:' + c + ';color:' + c + '"></span>';
            }
            if (dayActs.length > MAX_DOTS) {
              html += '<span class="cal-count">+' + (dayActs.length - MAX_DOTS) + '</span>';
            }
            html += '</div>';
          }

          html += '</div>';
          day++;
        }
      }
      html += '</div>';
    }

    grid.innerHTML = html;

    // Day click handler
    grid.addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-day');
      if (!cell) return;
      var date = cell.getAttribute('data-date');
      showDayPopup(date, cell, monthActivities);
    });

    // -------- Gantt timeline --------
    renderTimeline(monthActivities, daysInMonth, todayStr);

    // -------- Activity cards below --------
    renderActivityCards(monthActivities, detail);
  }

  // -------- Day Popup --------

  function showDayPopup(dateStr, anchorEl, monthActivities) {
    closePopup();
    selectedDate = dateStr;
    highlightSelected();

    var acts = getActivitiesForDate(monthActivities, dateStr);
    var parts = dateStr.split('-');
    var label = parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';

    var el = document.createElement('div');
    el.className = 'day-popup';

    var headerHtml = '<div class="day-popup-header"><h4>' + label + ' · ' + acts.length + '个活动</h4>';
    headerHtml += '<button class="day-popup-close">&times;</button></div>';

    var bodyHtml = '<div class="day-popup-list">';
    if (acts.length === 0) {
      bodyHtml += '<div class="day-popup-empty">当天无活动</div>';
    } else {
      acts.forEach(function (a) {
        var c = getColor(a.name);
        bodyHtml += '<div class="day-popup-item" data-name="' + escapeAttr(a.name) + '">';
        bodyHtml += '<span class="day-popup-dot" style="background:' + c + ';color:' + c + '"></span>';
        bodyHtml += '<span class="day-popup-name">' + escapeHtml(a.name) + '</span>';
        bodyHtml += '</div>';
      });
    }
    bodyHtml += '</div>';

    el.innerHTML = headerHtml + bodyHtml;

    // Position near the cell
    document.body.appendChild(el);
    var rect = anchorEl.getBoundingClientRect();
    var popH = el.offsetHeight;
    var popW = el.offsetWidth;
    var top = rect.bottom + 6;
    var left = rect.left + rect.width / 2 - popW / 2;
    if (top + popH > window.innerHeight - 10) top = rect.top - popH - 6;
    if (left < 10) left = 10;
    if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;
    el.style.top = top + 'px';
    el.style.left = left + 'px';

    popup = el;

    el.querySelector('.day-popup-close').onclick = closePopup;

    el.querySelectorAll('.day-popup-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var name = item.getAttribute('data-name');
        var card = document.querySelector('.activity-card[data-name="' + name + '"]');
        if (card) {
          closePopup();
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('highlight');
          setTimeout(function () { card.classList.remove('highlight'); }, 2000);
        }
      });
    });

    setTimeout(function () {
      document.addEventListener('click', onOutsideClick);
    }, 0);
  }

  function onOutsideClick(e) {
    if (popup && !popup.contains(e.target) && !e.target.closest('.cal-day')) {
      closePopup();
    }
  }

  function closePopup() {
    if (popup) {
      popup.remove();
      popup = null;
      selectedDate = null;
      highlightSelected();
      document.removeEventListener('click', onOutsideClick);
    }
  }

  function highlightSelected() {
    var cells = document.querySelectorAll('.cal-day');
    cells.forEach(function (c) {
      c.classList.toggle('cal-selected', c.getAttribute('data-date') === selectedDate);
    });
  }

  // -------- Gantt Timeline --------

  function renderTimeline(monthActivities, daysInMonth, todayStr) {
    var section = document.getElementById('activity-detail');
    var existing = document.querySelector('.timeline-section');
    if (existing) existing.remove();

    if (monthActivities.length === 0) return;

    var container = document.createElement('div');
    container.className = 'timeline-section';
    container.innerHTML = '<h3>活动时间线</h3>';

    var gantt = document.createElement('div');
    gantt.className = 'gantt-container';

    // Header row with dates
    var headerHtml = '<div class="gantt-header">';
    headerHtml += '<div class="gantt-header-label"></div>';
    headerHtml += '<div class="gantt-dates">';
    for (var d = 1; d <= daysInMonth; d++) {
      var ds = fmtDate(calYear, calMonth + 1, d);
      var dow = new Date(calYear, calMonth, d).getDay();
      var isWe = dow === 0 || dow === 6;
      var cls = 'gantt-date-cell';
      if (ds === todayStr) cls += ' gantt-today';
      else if (isWe) cls += ' gantt-weekend';
      headerHtml += '<div class="' + cls + '">' + d + '</div>';
    }
    headerHtml += '</div></div>';

    // Activity rows
    var rowsHtml = '';
    monthActivities.forEach(function (a) {
      var c = getColor(a.name);
      rowsHtml += '<div class="gantt-row">';
      rowsHtml += '<div class="gantt-row-label">';
      rowsHtml += '<span class="gantt-row-dot" style="background:' + c + '"></span>';
      rowsHtml += '<span class="gantt-row-name" title="' + escapeAttr(a.name) + '">' + escapeHtml(a.name) + '</span>';
      rowsHtml += '</div>';
      rowsHtml += '<div class="gantt-row-cells">';

      var aEnd = a.endDate || a.startDate;
      for (var d = 1; d <= daysInMonth; d++) {
        var ds = fmtDate(calYear, calMonth + 1, d);
        var isActive = a.startDate <= ds && aEnd >= ds;
        rowsHtml += '<div class="gantt-cell">';
        if (isActive) {
          var isStart = ds === a.startDate;
          var isEnd = ds === aEnd;
          var nextDs = fmtDate(calYear, calMonth + 1, d + 1);
          var prevDs = fmtDate(calYear, calMonth + 1, d - 1);
          var isVisualStart = isStart || d === 1 || !(a.startDate <= prevDs && aEnd >= prevDs);
          var isVisualEnd = isEnd || d === daysInMonth || !(a.startDate <= nextDs && aEnd >= nextDs);

          var barCls = 'gantt-bar';
          if (isVisualStart && isVisualEnd) barCls += ' gantt-bar-single';
          else if (isVisualStart) barCls += ' gantt-bar-start';
          else if (isVisualEnd) barCls += ' gantt-bar-end';

          rowsHtml += '<div class="' + barCls + '" style="background:' + c + ';left:0;right:0"></div>';
        }
        rowsHtml += '</div>';
      }

      rowsHtml += '</div></div>';
    });

    gantt.innerHTML = headerHtml + rowsHtml;
    container.appendChild(gantt);

    calendarView.querySelector('.calendar-grid').after(container);
  }

  // -------- Activity Cards --------

  function renderActivityCards(monthActivities, detailEl) {
    if (monthActivities.length === 0) {
      detailEl.innerHTML = '<p class="no-activities">本月暂无已排期的活动</p>';
      return;
    }

    var html = '<h3 class="detail-title">本月活动（' + monthActivities.length + '）</h3>';
    html += '<div class="activity-list">';

    monthActivities.forEach(function (a) {
      var c = getColor(a.name);
      html += '<div class="activity-card" data-name="' + escapeAttr(a.name) + '">';
      html += '<div class="activity-card-header">';
      html += '<span class="activity-dot" style="background:' + c + ';color:' + c + '"></span>';
      html += '<strong>' + escapeHtml(a.name) + '</strong>';
      html += '<span class="activity-source">' + escapeHtml(a.source) + '</span>';
      html += '</div>';
      html += '<div class="activity-dates">' +
        escapeHtml(a.startDate || '未定') + ' ~ ' + escapeHtml(a.endDate || '未定') +
        '</div>';

      if (a.rewards && a.rewards.length > 0) {
        html += '<div class="activity-rewards"><span class="rewards-label">奖励：</span>';
        a.rewards.forEach(function (rw) {
          html += '<span class="reward-tag">';
          html += escapeHtml(rw.name);
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
      return a.startDate <= dateStr && e >= dateStr;
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
