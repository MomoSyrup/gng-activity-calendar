(function () {
  'use strict';

  var activityDisplay = window.GngActivityDisplay || {};
  var activityInsights = window.GngActivityInsights || {};
  var eventUpload = window.GngEventUpload || {};

  var statusEl = document.getElementById('status');
  var statusLabel = statusEl ? statusEl.querySelector('.label') : null;
  var tabsEl = document.getElementById('tabs');
  var healthStripEl = document.getElementById('health-strip');
  var changeBannerEl = document.getElementById('change-banner');
  var typeFilterBarEl = document.getElementById('type-filter-bar');
  var quickViewBarEl = document.getElementById('quick-view-bar');
  var calendarView = document.getElementById('calendar-view');
  var upcomingView = document.getElementById('upcoming-view');
  var operationsView = document.getElementById('operations-view');
  var configView = document.getElementById('config-check-view');
  var favoritesStripEl = document.getElementById('favorites-strip');
  var updateTimeEl = document.getElementById('update-time');
  var themeToggle = document.getElementById('theme-toggle');
  var changelogOverlay = document.getElementById('changelog-overlay');
  var versionBtn = document.getElementById('version-btn');
  var changelogClose = document.getElementById('changelog-close');
  var copyFilterSummaryEl = document.getElementById('copy-filter-summary');
  var authUserPanelEl = document.getElementById('auth-user-panel');
  var authGateEl = document.getElementById('auth-gate');
  var authCardEl = document.getElementById('auth-card');

  var filterSearchEl = document.getElementById('filter-search');
  var filterStatusEl = document.getElementById('filter-status');
  var filterSourceEl = document.getElementById('filter-source');
  var filterRewardsEl = document.getElementById('filter-rewards');
  var filterAnomalyEl = document.getElementById('filter-anomaly');
  var filterResetEl = document.getElementById('filter-reset');
  var filterResultEl = document.getElementById('filter-result');

  var upcomingHeroEl = document.getElementById('upcoming-hero');
  var upcomingRangeBarEl = document.getElementById('upcoming-range-bar');
  var upcomingGroupsEl = document.getElementById('upcoming-groups');

  var operationsHeroGridEl = document.getElementById('operations-hero-grid');
  var operationsPaceEl = document.getElementById('operations-pace');
  var operationsCoverageEl = document.getElementById('operations-coverage');
  var operationsTypeBreakdownEl = document.getElementById('operations-type-breakdown');
  var operationsSourceBreakdownEl = document.getElementById('operations-source-breakdown');
  var operationsSummaryEl = document.getElementById('operations-summary');

  var opsHealthEl = document.getElementById('ops-health');
  var opsSummaryEl = document.getElementById('ops-anomaly-summary');
  var opsAnomalyListEl = document.getElementById('ops-anomaly-list');

  var drawerOverlayEl = document.getElementById('activity-drawer-overlay');
  var drawerEl = document.getElementById('activity-drawer');
  var drawerCloseEl = document.getElementById('activity-drawer-close');
  var drawerContentEl = document.getElementById('activity-drawer-content');

  var TAB_DEFS = [
    { key: '__calendar__', className: 'tab-calendar', label: '日历总览' },
    { key: '__upcoming__', className: 'tab-upcoming', label: '即将开始' },
    { key: '__operations__', className: 'tab-operations', label: '运营视角' },
    { key: '__config__', className: 'tab-config', label: '数据巡检' },
  ];

  var QUICK_VIEW_DEFS = [
    { key: 'all', label: '全部' },
    { key: 'today', label: '今天' },
    { key: 'week', label: '本周' },
    { key: 'month', label: '本月' },
    { key: 'active', label: '进行中' },
    { key: 'upcoming', label: '即将开始' },
    { key: 'favorites', label: '我的收藏' },
  ];

  var QUICK_VIEW_LABELS = {
    all: '全部',
    today: '今天',
    week: '本周',
    month: '本月',
    active: '进行中',
    upcoming: '即将开始',
    favorites: '我的收藏',
  };

  var TYPE_CSS = {
    '任务活动': 'type-tag-task',
    '抽奖活动': 'type-tag-gacha',
    '兑换活动': 'type-tag-redeem',
    '新抽奖': 'type-tag-bravo',
    '仅说明页活动': 'type-tag-overview',
    '网页活动': 'type-tag-web',
    '其他活动': 'type-tag-other',
    '未配置': 'type-tag-unconf',
  };

  var TYPE_FILTER_KEY = {
    '任务活动': 'task',
    '抽奖活动': 'gacha',
    '兑换活动': 'redeem',
    '新抽奖': 'bravo',
    '仅说明页活动': 'overview',
    '网页活动': 'web',
    '其他活动': 'other',
    '未配置': 'unconf',
  };

  var FILTER_LABELS = {
    all: '全部',
    task: '任务活动',
    gacha: '抽奖活动',
    redeem: '兑换活动',
    bravo: '新抽奖',
    overview: '仅说明页',
    web: '网页活动',
    other: '其他活动',
    unconf: '未配置',
  };

  var STATUS_LABELS = {
    active: '进行中',
    upcoming: '即将开始',
    ended: '已结束',
    undated: '未排期',
  };

  var CHANGE_LABELS = {
    added: '新增',
    removed: '移除',
    date_changed: '排期变更',
    type_changed: '类型变更',
    reward_changed: '奖励变更',
  };

  var COLORS = [
    '#818cf8', '#34d399', '#fbbf24', '#f87171', '#67e8f9',
    '#e879f9', '#2dd4bf', '#fb923c', '#60a5fa', '#a3e635',
    '#f472b6', '#22d3ee', '#facc15', '#a78bfa', '#4ade80',
    '#fb7185', '#7dd3fc', '#c084fc', '#86efac', '#f87171',
  ];

  var activityColorMap = {};
  var colorIndex = 0;
  var toastTimer = null;
  var socketClient = null;
  var googleAuthInitialized = false;
  var googleAuthClientId = '';
  var googleAuthRetryTimer = null;
  var googleAuthRetryAttempts = 0;

  var state = {
    activeTab: '__calendar__',
    quickView: 'all',
    activeTypeFilter: 'all',
    upcomingRange: 14,
    activities: [],
    calYear: null,
    calMonth: null,
    selectedDate: null,
    pendingFocusKey: null,
    drawerStableKey: '',
    lastUpdatedAt: '',
    favoriteKeys: loadFavoriteKeys(),
    recentChanges: null,
    health: {
      healthz: null,
      readyz: null,
      error: '',
    },
    auth: {
      enabled: false,
      authenticated: false,
      provider: 'google',
      clientId: '',
      allowedEmailDomains: [],
      loginUrl: '',
      logoutUrl: '',
      user: null,
      error: '',
    },
    filters: {
      search: '',
      status: 'all',
      source: 'all',
      rewards: 'all',
      anomaly: 'all',
    },
  };

  init();

  function init() {
    if (!tabsEl || !calendarView || !typeFilterBarEl) return;

    restoreStateFromUrl();
    initThemeToggle();
    initChangelogModal();
    initTabs();
    initFilterControls();
    initTypeFilterBar();
    initUpcomingRangeBar();
    initGlobalActions();
    initDrawer();
    initEventUploadPanel();

    renderTabs();
    switchView();
    syncFilterControls();
    renderAll();
    bootstrapApp();
  }

  function bootstrapApp() {
    fetchAuthSession()
      .then(function (payload) {
        applyAuthSession(payload);
        if (isAppUnlocked()) {
          initSocket();
          refreshAllData('initial');
          return;
        }
        renderAll();
      })
      .catch(function (error) {
        console.error('Failed to fetch auth session:', error);
        state.auth.error = '登录状态获取失败，正在尝试直接加载数据';
        renderAll();
        initSocket();
        refreshAllData('initial');
      });
  }

  function buildCurrentPath() {
    return window.location.pathname + window.location.search;
  }

  function buildFallbackLoginUrl() {
    return buildCurrentPath();
  }

  function buildFallbackLogoutUrl() {
    return '/auth/logout?next=' + encodeURIComponent(buildCurrentPath());
  }

  function isAppUnlocked() {
    return !state.auth.enabled || !!state.auth.authenticated;
  }

  function normalizeAuthState(payload) {
    var next = payload || {};
    return {
      enabled: !!next.enabled,
      authenticated: !!next.authenticated,
      provider: next.provider || 'google',
      clientId: next.clientId || '',
      allowedEmailDomains: Array.isArray(next.allowedEmailDomains) ? next.allowedEmailDomains.slice() : [],
      loginUrl: next.loginUrl || '',
      logoutUrl: next.logoutUrl || buildFallbackLogoutUrl(),
      user: next.user || null,
      error: next.error || '',
    };
  }

  function syncAuthLockState() {
    document.body.classList.toggle('auth-locked', !isAppUnlocked());
  }

  function fetchAuthSession() {
    return fetch('/api/auth/session?next=' + encodeURIComponent(buildCurrentPath()))
      .then(function (res) {
        if (!res.ok) throw new Error('auth session fetch failed');
        return res.json();
      });
  }

  function applyAuthSession(payload) {
    state.auth = normalizeAuthState(payload);
    syncAuthLockState();
    renderAuthChrome();
    renderAuthGate();

    if (!state.auth.enabled) return;

    if (state.auth.authenticated) {
      setStatus('awaiting', 'Signed in, connecting live updates');
      return;
    }

    setStatus('awaiting', 'Please sign in with your Garena Google account');
  }

  function buildAuthRequiredError(payload, fallbackMessage) {
    var normalized = normalizeAuthState({
      enabled: true,
      authenticated: false,
      provider: 'google',
      clientId: payload && payload.clientId ? payload.clientId : state.auth.clientId,
      allowedEmailDomains: payload && Array.isArray(payload.allowedEmailDomains)
        ? payload.allowedEmailDomains
        : getAllowedEmailDomains(),
      logoutUrl: payload && payload.logoutUrl,
      error: payload && payload.message ? payload.message : (fallbackMessage || 'Please sign in again with your Garena Google account'),
    });
    var error = new Error(normalized.error);
    error.code = 'authentication_required';
    error.authState = normalized;
    return error;
  }

  function isAuthRequiredError(error) {
    return !!(error && error.code === 'authentication_required');
  }

  function applyAuthRequired(error) {
    teardownSocket();
    closeDrawer();
    state.activities = [];
    state.recentChanges = null;
    state.lastUpdatedAt = '';
    state.auth = normalizeAuthState((error && error.authState) || {
      enabled: true,
      authenticated: false,
      provider: 'google',
      clientId: state.auth.clientId,
      allowedEmailDomains: getAllowedEmailDomains(),
      error: 'Please sign in again with your Garena Google account',
    });
    syncAuthLockState();
    setStatus('awaiting', 'Please sign in with your Garena Google account');
    renderAll();
  }

  function getAllowedEmailDomains() {
    if (Array.isArray(state.auth.allowedEmailDomains) && state.auth.allowedEmailDomains.length) {
      return state.auth.allowedEmailDomains.slice();
    }
    return ['garena.com', 'garena-external.com'];
  }

  function formatAllowedEmailDomains() {
    return getAllowedEmailDomains().map(function (domain) {
      return '@' + domain;
    }).join(' / ');
  }

  function ensureGoogleLoginClient() {
    if (!state.auth.clientId) return false;
    if (!window.google || !window.google.accounts || !window.google.accounts.id) return false;

    if (!googleAuthInitialized || googleAuthClientId !== state.auth.clientId) {
      window.google.accounts.id.initialize({
        client_id: state.auth.clientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleAuthInitialized = true;
      googleAuthClientId = state.auth.clientId;
    }

    return true;
  }

  function clearGoogleLoginRetry() {
    if (googleAuthRetryTimer) {
      window.clearTimeout(googleAuthRetryTimer);
      googleAuthRetryTimer = null;
    }
  }

  function scheduleGoogleLoginRetry() {
    clearGoogleLoginRetry();
    googleAuthRetryAttempts += 1;
    googleAuthRetryTimer = window.setTimeout(function () {
      renderGoogleLoginButton();
    }, Math.min(2000, 250 + (googleAuthRetryAttempts * 150)));
  }

  function setGoogleLoginUiState(options) {
    var next = options || {};
    var cta = document.getElementById('auth-google-cta');
    var status = document.getElementById('auth-google-status');

    if (cta) {
      cta.disabled = !!next.disabled;
      cta.classList.toggle('is-loading', !!next.loading);
    }

    if (status) {
      var tone = next.tone || '';
      status.className = 'auth-google-status' + (tone ? ' is-' + tone : '');
      status.hidden = !next.message;
      status.textContent = next.message || '';
    }
  }

  function renderGoogleLoginButton() {
    var buttonHost = document.getElementById('auth-google-button');
    if (!buttonHost) return;

    clearGoogleLoginRetry();
    buttonHost.innerHTML = '';

    if (!state.auth.enabled || state.auth.authenticated) return;

    if (!state.auth.clientId) {
      setGoogleLoginUiState({
        disabled: true,
        loading: false,
        tone: 'error',
        message: 'Google login is enabled, but no Google Client ID is configured yet.',
      });
      return;
    }

    if (!ensureGoogleLoginClient()) {
      if (googleAuthRetryAttempts < 12) {
        setGoogleLoginUiState({
          disabled: true,
          loading: true,
          tone: 'loading',
          message: 'Preparing Google sign-in...',
        });
        scheduleGoogleLoginRetry();
        return;
      }
      setGoogleLoginUiState({
        disabled: false,
        loading: false,
        tone: 'error',
        message: 'Google login script could not be loaded. Please check access to accounts.google.com and refresh.',
      });
      return;
    }

    googleAuthRetryAttempts = 0;

    window.google.accounts.id.renderButton(buttonHost, {
      theme: 'filled_black',
      size: 'large',
      type: 'standard',
      shape: 'pill',
      text: 'signin_with',
      locale: 'en',
      width: Math.max(320, Math.min(380, Math.round(buttonHost.getBoundingClientRect().width || 380))),
    });

    setGoogleLoginUiState({
      disabled: false,
      loading: false,
      message: '',
    });
    return;

    if (!state.auth.clientId) {
      setGoogleLoginUiState({
        disabled: true,
        loading: false,
        tone: 'error',
        message: 'Google login is enabled, but no Google Client ID is configured yet.',
      });
      return;
    }

    if (!ensureGoogleLoginClient()) {
      if (googleAuthRetryAttempts < 12) {
        buttonHost.innerHTML = '<div class="auth-note">Preparing Google sign-in…</div>';
        scheduleGoogleLoginRetry();
        return;
      }
      buttonHost.innerHTML = '<div class="auth-note">Google login script could not be loaded. Please check access to accounts.google.com and refresh.</div>';
      return;
    }

    googleAuthRetryAttempts = 0;

    window.google.accounts.id.renderButton(buttonHost, {
      theme: 'filled_black',
      size: 'medium',
      type: 'standard',
      shape: 'pill',
      text: 'signin_with',
      locale: 'en',
      width: 320,
    });
  }

  function handleGoogleCredentialResponse(response) {
    var credential = response && response.credential;
    if (!credential) {
      state.auth.error = 'Google login did not return a usable credential. Please try again.';
      renderAuthChrome();
      renderAuthGate();
      setStatus('awaiting', state.auth.error);
      return;
    }

    fetch('/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credential: credential,
        nextPath: buildCurrentPath(),
      }),
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (payload) {
          if (!res.ok) {
            throw buildAuthRequiredError(payload, payload && payload.message ? payload.message : 'Google login failed');
          }
          return payload;
        });
      })
      .then(function (payload) {
        applyAuthSession(payload);
        renderAll();
        if (isAppUnlocked()) {
          initSocket();
          refreshAllData('login');
        }
      })
      .catch(function (error) {
        var normalized = (error && error.authState) || normalizeAuthState({
          enabled: true,
          authenticated: false,
          provider: 'google',
          clientId: state.auth.clientId,
          allowedEmailDomains: getAllowedEmailDomains(),
          error: error && error.message ? error.message : 'Google login failed',
        });
        state.auth = normalized;
        syncAuthLockState();
        renderAuthChrome();
        renderAuthGate();
        setStatus('awaiting', normalized.error || 'Google login failed');
      });
  }

  function renderAuthChrome() {
    if (!authUserPanelEl) return;

    if (!state.auth.enabled) {
      authUserPanelEl.hidden = true;
      authUserPanelEl.innerHTML = '';
      return;
    }

    authUserPanelEl.hidden = false;

    if (!state.auth.authenticated) {
      authUserPanelEl.innerHTML = [
        '<a class="auth-chip auth-chip-login" href="#auth-gate">',
        '<span class="auth-avatar auth-avatar-fallback">G</span>',
        '<span class="auth-chip-copy"><strong>Google Sign-In</strong><small>Only Garena email accounts are allowed</small></span>',
        '</a>',
      ].join('');
      return;
    }

    var user = state.auth.user || {};
    var secondary = user.email || getPrimarySiteLabel(user) || 'Verified by Google';
    var avatarHtml = user.picture
      ? '<img class="auth-avatar-image" src="' + escapeAttr(user.picture) + '" alt="' + escapeAttr(user.name || 'Google user') + '" />'
      : '<span class="auth-avatar auth-avatar-fallback">' + escapeHtml(getUserInitial(user)) + '</span>';

    authUserPanelEl.innerHTML = [
      '<div class="auth-chip auth-chip-user">',
      avatarHtml,
      '<span class="auth-chip-copy"><strong>', escapeHtml(user.name || 'Google user'), '</strong><small>', escapeHtml(secondary), '</small></span>',
      '<a class="auth-link auth-link-secondary" href="', escapeAttr(state.auth.logoutUrl || buildFallbackLogoutUrl()), '">Sign out</a>',
      '</div>',
    ].join('');
  }

  function renderAuthGate() {
    if (!authGateEl || !authCardEl) return;

    if (!state.auth.enabled || state.auth.authenticated) {
      authGateEl.hidden = true;
      authCardEl.innerHTML = '';
      return;
    }

    var message = state.auth.error || 'This page is protected. Only Garena email accounts can open the activity calendar, operations dashboard, and Event upload tools.';
    var html = '';

    html += '<div class="auth-card-badges">';
    html += '<span class="auth-badge">Garena Google</span>';
    html += '<span class="auth-badge auth-badge-subtle">Domain allowlist</span>';
    html += '</div>';
    html += '<h2>Sign in with your Garena Google account</h2>';
    html += '<p>' + escapeHtml(message) + '</p>';
    html += '<div class="auth-note">Allowed domains: ' + escapeHtml(formatAllowedEmailDomains()) + '</div>';
    html += '<div class="auth-card-actions">';
    html += '<button class="auth-google-cta" id="auth-google-cta" type="button">';
    html += '<span class="auth-google-cta-logo" aria-hidden="true"><svg viewBox="0 0 18 18" focusable="false" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.05-1.25-.14-1.84H9v3.48h4.5a3.85 3.85 0 0 1-1.67 2.53v2.1h2.7c1.58-1.46 2.5-3.61 2.5-6.27z"></path><path fill="#34A853" d="M9 18c2.25 0 4.13-.75 5.5-2.03l-2.7-2.1c-.75.5-1.71.8-2.8.8-2.15 0-3.97-1.45-4.62-3.4H1.6v2.14A9 9 0 0 0 9 18z"></path><path fill="#FBBC05" d="M4.38 11.27A5.41 5.41 0 0 1 4.12 9c0-.78.14-1.53.38-2.27V4.59H1.6A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.01l3.42-1.74z"></path><path fill="#EA4335" d="M9 3.58c1.22 0 2.31.42 3.17 1.24l2.38-2.38C13.12 1.1 11.24 0 9 0A9 9 0 0 0 1.6 4.59l3.42 2.14C5.65 5.03 7.28 3.58 9 3.58z"></path></svg></span>';
    html += '<span class="auth-google-cta-copy"><strong>Continue with Google</strong><small>Only Garena email accounts are allowed</small></span>';
    html += '<span class="auth-google-cta-arrow" aria-hidden="true">&#8594;</span>';
    html += '</button>';
    html += '<div class="auth-google-button" id="auth-google-button" aria-hidden="true"></div>';
    html += '</div>';
    html += '<div class="auth-google-status" id="auth-google-status" hidden></div>';
    html += '<div class="auth-card-meta">After sign-in, the page will restore live updates and keep your current view.</div>';

    authCardEl.innerHTML = html;
    authGateEl.hidden = false;
    renderGoogleLoginButton();
  }

  function getUserInitial(user) {
    var source = (user && (user.name || user.email || user.accountId)) || 'G';
    return String(source).trim().charAt(0).toUpperCase() || 'G';
  }

  function getPrimarySiteLabel(user) {
    if (user && user.hostedDomain) return '@' + user.hostedDomain;
    return '';
  }

  function teardownSocket() {
    if (!socketClient) return;
    socketClient.disconnect();
    socketClient = null;
  }

  function initThemeToggle() {
    if (!themeToggle) return;
    themeToggle.innerHTML = getTheme() === 'light' ? '&#x2728;' : '&#9790;';
    themeToggle.addEventListener('click', function () {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  function initChangelogModal() {
    if (!changelogOverlay || !versionBtn || !changelogClose) return;

    versionBtn.addEventListener('click', function () {
      changelogOverlay.classList.add('open');
    });

    changelogClose.addEventListener('click', function () {
      changelogOverlay.classList.remove('open');
    });

    changelogOverlay.addEventListener('click', function (event) {
      if (event.target === changelogOverlay) {
        changelogOverlay.classList.remove('open');
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && changelogOverlay.classList.contains('open')) {
        changelogOverlay.classList.remove('open');
      }
    });
  }

  function initTabs() {
    tabsEl.addEventListener('click', function (event) {
      var btn = event.target.closest('.tab');
      if (!btn) return;
      state.activeTab = btn.getAttribute('data-tab') || '__calendar__';
      renderTabs();
      switchView();
      renderVisibleViews();
      syncUrlState();
    });
  }

  function initFilterControls() {
    if (filterSearchEl) {
      filterSearchEl.addEventListener('input', function () {
        state.filters.search = filterSearchEl.value.trim();
        renderAfterFilterChange();
      });
    }

    if (filterStatusEl) {
      filterStatusEl.addEventListener('change', function () {
        state.filters.status = filterStatusEl.value;
        renderAfterFilterChange();
      });
    }

    if (filterSourceEl) {
      filterSourceEl.addEventListener('change', function () {
        state.filters.source = filterSourceEl.value;
        renderAfterFilterChange();
      });
    }

    if (filterRewardsEl) {
      filterRewardsEl.addEventListener('change', function () {
        state.filters.rewards = filterRewardsEl.value;
        renderAfterFilterChange();
      });
    }

    if (filterAnomalyEl) {
      filterAnomalyEl.addEventListener('change', function () {
        state.filters.anomaly = filterAnomalyEl.value;
        renderAfterFilterChange();
      });
    }

    if (filterResetEl) {
      filterResetEl.addEventListener('click', function () {
        state.filters.search = '';
        state.filters.status = 'all';
        state.filters.source = 'all';
        state.filters.rewards = 'all';
        state.filters.anomaly = 'all';
        state.quickView = 'all';
        state.activeTypeFilter = 'all';
        syncFilterControls();
        renderAfterFilterChange();
      });
    }

    if (copyFilterSummaryEl) {
      copyFilterSummaryEl.addEventListener('click', function () {
        copyCurrentSummary();
      });
    }

    window.addEventListener('popstate', function () {
      restoreStateFromUrl();
      renderAll();
    });
  }

  function initTypeFilterBar() {
    typeFilterBarEl.addEventListener('click', function (event) {
      var btn = event.target.closest('.type-filter-btn');
      if (!btn) return;
      state.activeTypeFilter = btn.getAttribute('data-type') || 'all';
      renderAfterFilterChange();
    });
  }

  function initUpcomingRangeBar() {
    if (!upcomingRangeBarEl) return;
    upcomingRangeBarEl.addEventListener('click', function (event) {
      var btn = event.target.closest('.range-filter-btn');
      if (!btn) return;
      state.upcomingRange = parseInt(btn.getAttribute('data-range'), 10) || 14;
      renderUpcomingRangeBar();
      renderUpcomingView();
      syncUrlState();
    });
  }

  function initGlobalActions() {
    document.addEventListener('click', function (event) {
      var favoriteBtn = event.target.closest('[data-favorite-stable-key]');
      if (favoriteBtn) {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(favoriteBtn.getAttribute('data-favorite-stable-key'));
        return;
      }

      var copyActivityBtn = event.target.closest('[data-copy-activity-key]');
      if (copyActivityBtn) {
        event.preventDefault();
        event.stopPropagation();
        var copyActivity = findActivityByKey(copyActivityBtn.getAttribute('data-copy-activity-key'));
        if (copyActivity) copyActivitySummary(copyActivity);
        return;
      }

      var jumpBtn = event.target.closest('[data-jump-key]');
      if (jumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        var jumpActivity = findActivityByKey(jumpBtn.getAttribute('data-jump-key'));
        if (jumpActivity) jumpToActivity(jumpActivity);
        return;
      }

      var quickViewBtn = event.target.closest('[data-quick-view]');
      if (quickViewBtn) {
        event.preventDefault();
        event.stopPropagation();
        state.quickView = quickViewBtn.getAttribute('data-quick-view') || 'all';
        var targetTab = quickViewBtn.getAttribute('data-target-tab');
        if (targetTab) state.activeTab = targetTab;
        renderAll();
        return;
      }

      var copyOpsBtn = event.target.closest('[data-copy-operations]');
      if (copyOpsBtn) {
        event.preventDefault();
        event.stopPropagation();
        copyOperationsSummary();
        return;
      }

      var dismissBtn = event.target.closest('[data-dismiss-changes]');
      if (dismissBtn) {
        event.preventDefault();
        state.recentChanges = null;
        renderChangeBanner();
        return;
      }

      var openStableBtn = event.target.closest('[data-open-stable-key]');
      if (openStableBtn) {
        event.preventDefault();
        var stableActivity = findActivityByStableKey(openStableBtn.getAttribute('data-open-stable-key'));
        if (stableActivity) openDrawer(stableActivity);
        return;
      }

      var openBtn = event.target.closest('[data-open-key]');
      if (openBtn) {
        event.preventDefault();
        var activity = findActivityByKey(openBtn.getAttribute('data-open-key'));
        if (activity) openDrawer(activity);
      }
    });
  }

  function initDrawer() {
    if (drawerCloseEl) {
      drawerCloseEl.addEventListener('click', closeDrawer);
    }

    if (drawerOverlayEl) {
      drawerOverlayEl.addEventListener('click', function (event) {
        if (event.target === drawerOverlayEl) closeDrawer();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.drawerStableKey) {
        closeDrawer();
      }
    });
  }

  function initEventUploadPanel() {
    if (eventUpload.initEventUploadPanel) {
      eventUpload.initEventUploadPanel({
        onSuccess: function () {
          refreshAllData('upload');
        },
        onAuthRequired: function (error) {
          applyAuthRequired(error);
        }
      });
      return;
    }

    var form = document.getElementById('event-upload-form');
    if (!form) return;

    var fileInput = document.getElementById('event-file-input');
    var status = document.getElementById('event-upload-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (event) {
      event.preventDefault();

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
          refreshAllData('upload');
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

  function initSocket() {
    if (typeof io !== 'function' || socketClient) return;
    socketClient = io();

    socketClient.on('connect', function () {
      setStatus('connected', '已连接');
    });

    socketClient.on('connect_error', function (error) {
      if (error && error.message === 'authentication_required') {
        applyAuthRequired(buildAuthRequiredError({}, 'Your session expired. Please sign in again.'));
        return;
      }
      setStatus('disconnected', '已断开，正在重连');
    });

    socketClient.on('disconnect', function () {
      setStatus('disconnected', '已断开，重连中…');
    });

    socketClient.on('sheet:update', function () {
      refreshAllData('socket');
    });
  }

  function refreshAllData(triggerSource) {
    var previousActivities = state.activities.slice();

    Promise.allSettled([
      fetchCalendarData(),
      fetchHealthPayload('/healthz'),
      fetchHealthPayload('/readyz'),
    ])
      .then(function (results) {
        if (results[0].status === 'rejected' && isAuthRequiredError(results[0].reason)) {
          applyAuthRequired(results[0].reason);
          return;
        }

        if (results[0].status === 'fulfilled') {
          var nextActivities = results[0].value.activities || [];
          state.activities = nextActivities;
          assignColors();
          state.lastUpdatedAt = new Date().toISOString();

          if (previousActivities.length > 0 && triggerSource !== 'initial') {
            var diff = diffActivityLists(previousActivities, nextActivities);
            state.recentChanges = diff.summary.total > 0 ? diff : null;
          }
        }

        if (results[1].status === 'fulfilled') {
          state.health.healthz = results[1].value;
        }

        if (results[2].status === 'fulfilled') {
          state.health.readyz = results[2].value;
        }

        state.health.error = buildHealthError(results);
        renderAll();
      })
      .catch(function (err) {
        console.error('Failed to refresh data:', err);
      });
  }

  function renderAll() {
    syncAuthLockState();
    renderAuthChrome();
    renderAuthGate();
    syncFilterControls();
    renderTabs();
    switchView();
    renderHealthStrip();
    renderChangeBanner();
    renderSourceOptions();
    renderQuickViewBar();
    renderFilterResult();
    renderTypeFilterBar();
    renderVisibleViews();
    renderFooterTimestamp();
    renderDrawer();
    syncUrlState();
  }

  function renderAfterFilterChange() {
    renderAll();
  }

  function renderVisibleViews() {
    renderFavoritesStrip();
    renderActiveNow();
    renderCalendar();
    renderUpcomingRangeBar();
    renderUpcomingView();
    renderOperationsView();
    renderInspectionView();
  }

  function renderTabs() {
    var html = '';
    TAB_DEFS.forEach(function (tab) {
      html += '<button class="tab ' + tab.className + (tab.key === state.activeTab ? ' active' : '') + '" data-tab="' + tab.key + '">';
      html += escapeHtml(tab.label);
      html += '</button>';
    });
    tabsEl.innerHTML = html;
  }

  function switchView() {
    calendarView.style.display = state.activeTab === '__calendar__' ? '' : 'none';
    upcomingView.style.display = state.activeTab === '__upcoming__' ? '' : 'none';
    operationsView.style.display = state.activeTab === '__operations__' ? '' : 'none';
    configView.style.display = state.activeTab === '__config__' ? '' : 'none';
  }

  function syncFilterControls() {
    if (filterSearchEl) filterSearchEl.value = state.filters.search;
    if (filterStatusEl) filterStatusEl.value = state.filters.status;
    if (filterRewardsEl) filterRewardsEl.value = state.filters.rewards;
    if (filterAnomalyEl) filterAnomalyEl.value = state.filters.anomaly;
  }

  function renderSourceOptions() {
    if (!filterSourceEl) return;
    var sourceOptions = listSources(state.activities);
    var html = '<option value="all">全部来源</option>';
    sourceOptions.forEach(function (source) {
      html += '<option value="' + escapeAttr(source) + '">' + escapeHtml(source) + '</option>';
    });
    filterSourceEl.innerHTML = html;

    if (state.filters.source !== 'all' && sourceOptions.indexOf(state.filters.source) === -1) {
      state.filters.source = 'all';
    }
    filterSourceEl.value = state.filters.source;
  }

  function renderHealthStrip() {
    if (!healthStripEl) return;

    var readyPayload = state.health.readyz || {};
    var healthPayload = state.health.healthz || {};
    var ready = !!readyPayload.ready;
    var pollHealthy = !!healthPayload.lastPollSuccessAt && !healthPayload.lastPollError;
    var snapshotCount = Number(healthPayload.snapshotActivities || 0);

    var cards = [
      {
        className: ready ? 'ok' : 'warn',
        title: '数据就绪',
        value: ready ? '已就绪' : '准备中',
        meta: ready ? '首轮拉取已完成' : '等待首轮数据完成',
      },
      {
        className: pollHealthy ? 'ok' : 'warn',
        title: '最新轮询',
        value: healthPayload.lastPollSuccessAt ? formatRelativeTime(healthPayload.lastPollSuccessAt) : '暂无',
        meta: healthPayload.lastPollError || '轮询状态正常',
      },
      {
        className: snapshotCount > 0 ? 'ok' : 'warn',
        title: '快照兜底',
        value: snapshotCount + ' 条活动',
        meta: '缓存表数 ' + Number(healthPayload.cachedSheetCount || 0) + '，间隔 ' + formatPollInterval(healthPayload.pollIntervalMs),
      },
      {
        className: 'neutral',
        title: '运行版本',
        value: healthPayload.version ? ('v' + healthPayload.version) : '未知',
        meta: healthPayload.uptimeSeconds ? ('已运行 ' + formatUptime(healthPayload.uptimeSeconds)) : '等待运行时信息',
      },
    ];

    var html = '<div class="health-strip-grid">';
    cards.forEach(function (card) {
      html += '<div class="health-card ' + card.className + '">';
      html += '<div class="health-card-title">' + escapeHtml(card.title) + '</div>';
      html += '<div class="health-card-value">' + escapeHtml(card.value) + '</div>';
      html += '<div class="health-card-meta">' + escapeHtml(card.meta) + '</div>';
      html += '</div>';
    });
    html += '</div>';

    if (state.health.error) {
      html += '<div class="health-strip-note warning">' + escapeHtml(state.health.error) + '</div>';
    } else if (healthPayload.lastPollError) {
      html += '<div class="health-strip-note warning">最近一次轮询报错：' + escapeHtml(healthPayload.lastPollError) + '</div>';
    } else {
      html += '<div class="health-strip-note">页面状态基于 <code>/healthz</code> 和 <code>/readyz</code> 实时同步。</div>';
    }

    healthStripEl.innerHTML = html;
  }

  function renderChangeBanner() {
    if (!changeBannerEl) return;
    if (!state.recentChanges || !state.recentChanges.summary.total) {
      changeBannerEl.innerHTML = '';
      changeBannerEl.classList.remove('visible');
      return;
    }

    var summary = state.recentChanges.summary;
    var summaryParts = [];
    ['added', 'date_changed', 'type_changed', 'reward_changed', 'removed'].forEach(function (key) {
      if (summary[key] > 0) summaryParts.push(CHANGE_LABELS[key] + ' ' + summary[key]);
    });

    var html = '<div class="change-banner-card">';
    html += '<div class="change-banner-top">';
    html += '<div class="change-banner-title"><span class="change-banner-pulse"></span>数据已刷新</div>';
    html += '<div class="change-banner-summary">' + escapeHtml(summaryParts.join(' · ')) + '</div>';
    html += '<button class="change-banner-close" type="button" data-dismiss-changes="true">收起</button>';
    html += '</div>';

    var previewEntries = state.recentChanges.entries.slice(0, 6);
    if (previewEntries.length > 0) {
      html += '<div class="change-chip-list">';
      previewEntries.forEach(function (entry) {
        var stableKey = entry.stableKey;
        var changedActivity = entry.activity || findActivityByStableKey(stableKey);
        var isClickable = entry.type !== 'removed' && !!changedActivity;
        var tag = isClickable ? 'button' : 'span';
        html += '<' + tag + ' class="change-chip change-chip-' + entry.type + '"';
        if (isClickable) html += ' data-open-stable-key="' + escapeAttr(stableKey) + '"';
        if (isClickable) html += ' type="button"';
        html += '>' + escapeHtml(CHANGE_LABELS[entry.type] + ' · ' + entry.label) + '</' + tag + '>';
      });
      html += '</div>';
    }

    html += '</div>';
    changeBannerEl.innerHTML = html;
    changeBannerEl.classList.add('visible');
  }

  function renderQuickViewBar() {
    if (!quickViewBarEl) return;

    var baseActivities = getFilteredActivities({
      includeQuickView: false,
      includeTypeFilter: false,
    });

    var html = '<div class="quick-view-inner">';
    QUICK_VIEW_DEFS.forEach(function (view) {
      var count = countQuickViewActivities(baseActivities, view.key);
      html += '<button class="quick-view-btn' + (state.quickView === view.key ? ' active' : '') + '" data-quick-view="' + view.key + '" type="button">';
      html += escapeHtml(view.label);
      html += '<span class="quick-view-count">' + count + '</span>';
      html += '</button>';
    });
    html += '</div>';
    quickViewBarEl.innerHTML = html;
  }

  function renderFilterResult() {
    if (!filterResultEl) return;
    var filtered = getFilteredActivities();
    var anomalyCount = filtered.filter(function (activity) {
      return getAnomalyFlags(activity).length > 0;
    }).length;
    var quickViewText = QUICK_VIEW_LABELS[state.quickView] || QUICK_VIEW_LABELS.all;
    filterResultEl.textContent = '当前筛出 ' + filtered.length + ' / ' + state.activities.length + ' 个活动，异常 ' + anomalyCount + ' 个，快捷视图：' + quickViewText;
  }

  function renderTypeFilterBar() {
    var baseActivities = getFilteredActivities({ includeTypeFilter: false });
    var counts = getTypeCounts(baseActivities);
    var filters = ['all', 'task', 'gacha', 'redeem', 'bravo', 'overview', 'web', 'other', 'unconf'];
    var html = '';
    filters.forEach(function (key) {
      var count = counts[key] || 0;
      if (key !== 'all' && count === 0) return;
      html += '<button class="type-filter-btn' + (state.activeTypeFilter === key ? ' active' : '') + '" data-type="' + key + '">';
      html += escapeHtml(FILTER_LABELS[key] || key);
      if (count > 0) html += '<span class="filter-count">' + count + '</span>';
      html += '</button>';
    });
    typeFilterBarEl.innerHTML = html;
  }

  function renderFavoritesStrip() {
    if (!favoritesStripEl) return;

    var favorites = state.activities
      .filter(isFavorite)
      .sort(compareActivitiesForDisplay)
      .slice(0, 8);

    if (favorites.length === 0) {
      favoritesStripEl.innerHTML = '';
      return;
    }

    var periodMap = buildPeriodIndexMap(state.activities);
    var html = '<div class="favorites-strip-head">';
    html += '<div><h3>我的关注</h3><span>' + favorites.length + ' 个活动</span></div>';
    html += '<button class="inline-action" type="button" data-quick-view="favorites">只看收藏</button>';
    html += '</div>';
    html += '<div class="favorites-strip-list">';

    favorites.forEach(function (activity) {
      var identityKey = activityIdentityKey(activity);
      var stableKey = getStableActivityKey(activity);
      var changed = isRecentlyChanged(activity);
      html += '<article class="favorite-card' + (changed ? ' changed' : '') + '" data-open-key="' + escapeAttr(identityKey) + '">';
      html += '<div class="favorite-card-top">';
      html += '<span class="meta-pill status-' + getStatusKey(activity, todayKey()) + '">' + escapeHtml(STATUS_LABELS[getStatusKey(activity, todayKey())]) + '</span>';
      if (changed) html += '<span class="change-mini-badge">刚更新</span>';
      html += '<button class="favorite-toggle' + (isFavorite(activity) ? ' active' : '') + '" type="button" data-favorite-stable-key="' + escapeAttr(stableKey) + '">' + favoriteIcon(isFavorite(activity)) + '</button>';
      html += '</div>';
      html += '<div class="favorite-card-title">' + escapeHtml(getDisplayName(activity, periodMap)) + '</div>';
      html += '<div class="favorite-card-meta">' + escapeHtml((activity.startDate || '未定') + ' ~ ' + (getEndDate(activity) || '未定')) + '</div>';
      html += '</article>';
    });

    html += '</div>';
    favoritesStripEl.innerHTML = html;
  }

  function renderActiveNow() {
    var container = document.getElementById('active-now');
    if (!container) return;

    var todayStr = todayKey();
    var periodMap = buildPeriodIndexMap(state.activities);
    var active = getFilteredActivities().filter(function (activity) {
      return getStatusKey(activity, todayStr) === 'active' && !hasType(activity, '未配置');
    });

    if (active.length === 0) {
      container.innerHTML = '';
      return;
    }

    var today = parseDate(todayStr);
    var todayMs = today ? today.getTime() : Date.now();
    var html = '<div class="active-now-header">';
    html += '<span class="active-now-pulse"></span>';
    html += '正在进行';
    html += '<span class="active-now-count">' + active.length + ' 个活动进行中</span>';
    html += '</div>';
    html += '<div class="active-now-scroll">';

    active.forEach(function (activity) {
      var color = getColor(activity.name);
      var start = parseDate(activity.startDate);
      var end = parseDate(getEndDate(activity));
      var totalDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1) : 1;
      var elapsed = start ? Math.max(0, Math.round((todayMs - start.getTime()) / 86400000)) : 0;
      var remaining = end ? Math.max(0, Math.round((end.getTime() - todayMs) / 86400000)) : 0;
      var progress = Math.min(100, Math.round(elapsed / totalDays * 100));
      var stableKey = getStableActivityKey(activity);
      var changed = isRecentlyChanged(activity);

      html += '<div class="active-now-card' + (changed ? ' changed' : '') + '" data-open-key="' + escapeAttr(activityIdentityKey(activity)) + '" style="--card-color:' + color + '">';
      html += '<div class="active-now-card-top">';
      html += '<span class="active-now-dot" style="background:' + color + ';color:' + color + '"></span>';
      html += '<span class="active-now-name" title="' + escapeAttr(getDisplayName(activity, periodMap)) + '">' + escapeHtml(getDisplayName(activity, periodMap)) + '</span>';
      html += '<button class="favorite-toggle' + (isFavorite(activity) ? ' active' : '') + '" type="button" data-favorite-stable-key="' + escapeAttr(stableKey) + '">' + favoriteIcon(isFavorite(activity)) + '</button>';
      html += '</div>';
      html += '<div class="active-now-card-mid">';
      if (activity.types && activity.types[0]) {
        html += '<span class="type-tag ' + (TYPE_CSS[activity.types[0]] || '') + '">' + escapeHtml(activity.types[0]) + '</span>';
      }
      if (changed) html += '<span class="change-mini-badge">刚更新</span>';
      html += '<span class="active-now-remaining">' + (remaining === 0 ? '今天结束' : ('剩余 ' + remaining + ' 天')) + '</span>';
      html += '</div>';
      html += '<div class="active-now-progress"><div class="active-now-progress-fill" style="width:' + progress + '%;background:' + color + '"></div></div>';
      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  function renderCalendar() {
    initCalendarMonth();

    var filteredActivities = getFilteredActivities();
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    var monthStart = fmtDate(state.calYear, state.calMonth + 1, 1);
    var monthEnd = fmtDate(state.calYear, state.calMonth + 1, daysInMonth);
    var monthActivities = filteredActivities.filter(function (activity) {
      return activity.startDate && activity.startDate <= monthEnd && getEndDate(activity) >= monthStart;
    });
    var periodMap = buildPeriodIndexMap(state.activities);

    var calTitle = document.getElementById('cal-title');
    if (calTitle) calTitle.textContent = state.calYear + ' 年 ' + (state.calMonth + 1) + ' 月';

    bindCalendarControls();
    if (!state.selectedDate) state.selectedDate = todayKey();

    var selected = parseDate(state.selectedDate);
    if (!selected || selected.getFullYear() !== state.calYear || selected.getMonth() !== state.calMonth) {
      state.selectedDate = monthStart;
    }

    renderMiniCalendar(daysInMonth, monthActivities, todayKey());
    renderSidebar(monthActivities, periodMap);
    renderSwimlaneTimeline(monthActivities, daysInMonth, periodMap);
    renderActivityCards(monthActivities, document.getElementById('activity-detail'), periodMap);
  }

  function bindCalendarControls() {
    var prevBtn = document.getElementById('cal-prev');
    var nextBtn = document.getElementById('cal-next');
    var todayBtn = document.getElementById('cal-today');

    if (prevBtn) {
      prevBtn.onclick = function () {
        state.calMonth -= 1;
        if (state.calMonth < 0) {
          state.calMonth = 11;
          state.calYear -= 1;
        }
        state.selectedDate = null;
        renderCalendar();
        syncUrlState();
      };
    }

    if (nextBtn) {
      nextBtn.onclick = function () {
        state.calMonth += 1;
        if (state.calMonth > 11) {
          state.calMonth = 0;
          state.calYear += 1;
        }
        state.selectedDate = null;
        renderCalendar();
        syncUrlState();
      };
    }

    if (todayBtn) {
      todayBtn.onclick = function () {
        var now = new Date();
        state.calYear = now.getFullYear();
        state.calMonth = now.getMonth();
        state.selectedDate = todayKey();
        renderCalendar();
        syncUrlState();
      };
    }
  }

  function initCalendarMonth() {
    if (state.calYear != null) return;
    var now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth();
  }

  function renderMiniCalendar(daysInMonth, monthActivities, todayStr) {
    var bodyEl = document.getElementById('calendar-body');
    if (!bodyEl) return;

    var firstDay = new Date(state.calYear, state.calMonth, 1);
    var startDow = (firstDay.getDay() + 6) % 7;
    var html = '<div class="mini-cal-panel"><div class="mini-cal-grid">';

    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (weekday) {
      html += '<div class="mini-cal-weekday">' + weekday + '</div>';
    });

    for (var index = 0; index < startDow; index += 1) {
      html += '<div class="mini-cal-day mini-cal-empty"></div>';
    }

    for (var day = 1; day <= daysInMonth; day += 1) {
      var dateStr = fmtDate(state.calYear, state.calMonth + 1, day);
      var dayActivities = getActivitiesForDate(monthActivities, dateStr);
      var classes = 'mini-cal-day';
      if (dateStr === todayStr) classes += ' today';
      if (dateStr === state.selectedDate) classes += ' selected';
      if (dayActivities.length > 0) classes += ' has-events';
      html += '<div class="' + classes + '" data-date="' + dateStr + '">' + day + '</div>';
    }

    html += '</div></div>';
    html += '<div class="sidebar-panel" id="sidebar-panel"></div>';
    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.mini-cal-day:not(.mini-cal-empty)').forEach(function (cell) {
      cell.addEventListener('click', function () {
        state.selectedDate = cell.getAttribute('data-date');
        renderMiniCalendar(daysInMonth, monthActivities, todayStr);
        renderSidebar(monthActivities, buildPeriodIndexMap(state.activities));
        syncUrlState();
      });
    });
  }

  function renderSidebar(monthActivities, periodMap) {
    var panel = document.getElementById('sidebar-panel');
    if (!panel) return;

    var dateValue = state.selectedDate || fmtDate(state.calYear, state.calMonth + 1, 1);
    var parts = dateValue.split('-');
    var label = parseInt(parts[1], 10) + ' 月 ' + parseInt(parts[2], 10) + ' 日';
    var activities = getActivitiesForDate(monthActivities, dateValue).sort(compareActivitiesForDisplay);
    var html = '<div class="sidebar-title">' + label;
    html += '<span class="sidebar-count">' + activities.length + ' 个活动</span>';
    html += '</div>';

    if (activities.length === 0) {
      html += '<div class="sidebar-empty">当天没有活动</div>';
    } else {
      html += '<div class="sidebar-list">';
      activities.forEach(function (activity) {
        var identityKey = activityIdentityKey(activity);
        var color = getColor(activity.name);
        html += '<div class="sidebar-item" data-open-key="' + escapeAttr(identityKey) + '">';
        html += '<span class="sidebar-dot" style="background:' + color + ';color:' + color + '"></span>';
        html += '<div class="sidebar-info">';
        html += '<div class="sidebar-name">' + escapeHtml(getDisplayName(activity, periodMap)) + '</div>';
        html += '<div class="sidebar-date">' + escapeHtml(activity.startDate || '未定') + ' ~ ' + escapeHtml(getEndDate(activity) || '未定') + '</div>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    panel.innerHTML = html;
  }

  function renderSwimlaneTimeline(monthActivities, daysInMonth, periodMap) {
    var section = document.getElementById('timeline-section');
    if (!section) return;
    if (monthActivities.length === 0) {
      section.innerHTML = '';
      return;
    }

    var groups = {};
    var order = ['task', 'gacha', 'redeem', 'bravo', 'overview', 'web', 'other', 'unconf'];

    monthActivities.forEach(function (activity) {
      var key = 'unconf';
      if (activity.types && activity.types[0]) {
        key = TYPE_FILTER_KEY[activity.types[0]] || 'unconf';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(activity);
    });

    var html = '<div class="timeline-header">活动时间线</div>';
    order.forEach(function (groupKey) {
      var list = groups[groupKey];
      if (!list || list.length === 0) return;

      html += '<div class="swimlane-group">';
      html += '<div class="swimlane-group-title">' + escapeHtml(FILTER_LABELS[groupKey]) + '</div>';

      list.forEach(function (activity) {
        var color = getColor(activity.name);
        var startDate = activity.startDate || fmtDate(state.calYear, state.calMonth + 1, 1);
        var endDate = getEndDate(activity) || fmtDate(state.calYear, state.calMonth + 1, daysInMonth);
        var monthStart = new Date(state.calYear, state.calMonth, 1);
        var monthEnd = new Date(state.calYear, state.calMonth + 1, 0);
        var clampedStart = new Date(Math.max(parseDate(startDate).getTime(), monthStart.getTime()));
        var clampedEnd = new Date(Math.min(parseDate(endDate).getTime(), monthEnd.getTime()));
        var dayStart = clampedStart.getDate();
        var dayEnd = clampedEnd.getDate();
        var leftPct = ((dayStart - 1) / daysInMonth * 100).toFixed(1);
        var widthPct = ((dayEnd - dayStart + 1) / daysInMonth * 100).toFixed(1);
        if (parseFloat(widthPct) < 3) widthPct = '3';

        html += '<div class="swimlane-row">';
        html += '<span class="swimlane-name" title="' + escapeAttr(getDisplayName(activity, periodMap)) + '">' + escapeHtml(getDisplayName(activity, periodMap)) + '</span>';
        html += '<div class="swimlane-bar-track">';
        html += '<div class="swimlane-bar" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + color + ';--bar-c:' + color + '">';
        if (parseFloat(widthPct) > 12) {
          html += escapeHtml((startDate.slice(5) + ' - ' + endDate.slice(5)).replace(/-/g, '/'));
        }
        html += '</div>';
        html += '</div>';
        html += '<span class="swimlane-dates">' + escapeHtml(startDate) + ' ~ ' + escapeHtml(endDate) + '</span>';
        html += '</div>';
      });

      html += '</div>';
    });

    section.innerHTML = html;
  }

  function renderActivityCards(monthActivities, detailEl, periodMap) {
    if (!detailEl) return;

    if (monthActivities.length === 0) {
      detailEl.innerHTML = '<p class="no-activities">当前筛选条件下，本月暂无活动</p>';
      return;
    }

    var html = '<div class="detail-headline">';
    html += '<h3 class="detail-title">本月活动</h3>';
    html += '<span class="detail-count">' + monthActivities.length + ' 个</span>';
    html += '</div>';
    html += '<div class="activity-list">';

    monthActivities.sort(compareActivitiesForDisplay).forEach(function (activity) {
      html += renderActivityCard(activity, periodMap);
    });

    html += '</div>';
    detailEl.innerHTML = html;
    focusPendingCard();
  }

  function renderActivityCard(activity, periodMap) {
    var displayName = getDisplayName(activity, periodMap);
    var identityKey = activityIdentityKey(activity);
    var stableKey = getStableActivityKey(activity);
    var rewards = Array.isArray(activity.rewards) ? activity.rewards : [];
    var anomalies = getAnomalyFlags(activity);
    var changed = isRecentlyChanged(activity);
    var html = '<article class="activity-card' + (changed ? ' changed' : '') + '" data-open-key="' + escapeAttr(identityKey) + '">';
    html += '<div class="activity-card-header">';
    html += '<span class="activity-dot" style="background:' + getColor(activity.name) + ';color:' + getColor(activity.name) + '"></span>';
    html += '<strong>' + escapeHtml(displayName) + '</strong>';
    html += '<div class="activity-card-actions">';
    if (changed) html += '<span class="change-mini-badge">刚更新</span>';
    html += '<button class="favorite-toggle' + (isFavorite(activity) ? ' active' : '') + '" type="button" data-favorite-stable-key="' + escapeAttr(stableKey) + '">' + favoriteIcon(isFavorite(activity)) + '</button>';
    html += '<span class="activity-source">' + escapeHtml(activity.source || '未知来源') + '</span>';
    html += '</div>';
    html += '</div>';

    html += '<div class="activity-meta-row">';
    html += '<span class="meta-pill status-' + getStatusKey(activity, todayKey()) + '">' + escapeHtml(STATUS_LABELS[getStatusKey(activity, todayKey())]) + '</span>';
    if (activity.eventId) html += '<span class="meta-pill">Event ' + escapeHtml(String(activity.eventId)) + '</span>';
    if (activity.types) html += renderTypeTags(activity.types);
    html += '</div>';

    html += '<div class="activity-dates">' + escapeHtml(activity.startDate || '未定') + ' ~ ' + escapeHtml(getEndDate(activity) || '未定') + '</div>';

    if (rewards.length > 0) {
      html += '<div class="activity-rewards"><span class="rewards-label">奖励</span>';
      rewards.forEach(function (reward) {
        html += '<span class="reward-tag">' + escapeHtml(reward.name || '未命名奖励');
        if (reward.itemId) html += '<code>' + escapeHtml(String(reward.itemId)) + '</code>';
        html += '</span>';
      });
      html += '</div>';
    } else {
      html += '<div class="activity-rewards empty"><span class="rewards-label">奖励</span><span class="reward-empty">当前没有奖励配置</span></div>';
    }

    if (anomalies.length > 0) {
      html += '<div class="activity-anomalies">';
      anomalies.forEach(function (flag) {
        html += '<span class="anomaly-badge">' + escapeHtml(anomalyLabel(flag)) + '</span>';
      });
      html += '</div>';
    }

    html += '</article>';
    return html;
  }

  function renderUpcomingRangeBar() {
    if (!upcomingRangeBarEl) return;
    var html = '';
    [7, 14, 30].forEach(function (range) {
      html += '<button class="range-filter-btn' + (state.upcomingRange === range ? ' active' : '') + '" data-range="' + range + '" type="button">未来 ' + range + ' 天</button>';
    });
    upcomingRangeBarEl.innerHTML = html;
  }

  function renderUpcomingView() {
    if (!upcomingHeroEl || !upcomingGroupsEl) return;

    var filtered = getFilteredActivities();
    var groups = buildUpcomingGroups(filtered, state.upcomingRange, todayKey());
    var total = groups.reduce(function (sum, group) {
      return sum + group.items.length;
    }, 0);
    var nextDate = groups.length > 0 ? groups[0].date : '';
    var heroHtml = '<div class="upcoming-hero-card">';
    heroHtml += '<div class="upcoming-hero-title">未来 ' + state.upcomingRange + ' 天即将开始</div>';
    heroHtml += '<div class="upcoming-hero-value">' + total + ' 个活动</div>';
    heroHtml += '<div class="upcoming-hero-meta">' + (nextDate ? ('最近开始：' + formatDisplayDate(nextDate)) : '当前筛选条件下暂无即将开始的活动') + '</div>';
    heroHtml += '</div>';
    upcomingHeroEl.innerHTML = heroHtml;

    if (groups.length === 0) {
      upcomingGroupsEl.innerHTML = '<div class="empty-state">未来 ' + state.upcomingRange + ' 天内没有即将开始的活动。</div>';
      return;
    }

    var periodMap = buildPeriodIndexMap(state.activities);
    var html = '';
    groups.forEach(function (group) {
      html += '<section class="upcoming-day-block">';
      html += '<div class="upcoming-day-header">';
      html += '<div><strong>' + escapeHtml(formatDisplayDate(group.date)) + '</strong><span>' + group.items.length + ' 个活动</span></div>';
      html += '<span class="upcoming-day-offset">' + escapeHtml(diffFromToday(group.date)) + '</span>';
      html += '</div>';
      html += '<div class="upcoming-day-list">';

      group.items.sort(compareActivitiesForDisplay).forEach(function (activity) {
        var identityKey = activityIdentityKey(activity);
        var stableKey = getStableActivityKey(activity);
        var anomalies = getAnomalyFlags(activity);
        var changed = isRecentlyChanged(activity);

        html += '<article class="upcoming-card' + (changed ? ' changed' : '') + '" data-open-key="' + escapeAttr(identityKey) + '">';
        html += '<div class="upcoming-card-top">';
        html += '<h3>' + escapeHtml(getDisplayName(activity, periodMap)) + '</h3>';
        html += '<button class="favorite-toggle' + (isFavorite(activity) ? ' active' : '') + '" type="button" data-favorite-stable-key="' + escapeAttr(stableKey) + '">' + favoriteIcon(isFavorite(activity)) + '</button>';
        html += '<span class="activity-source">' + escapeHtml(activity.source || '未知来源') + '</span>';
        html += '</div>';
        html += '<div class="upcoming-card-meta">';
        html += '<span class="meta-pill">' + escapeHtml(activity.startDate || '未定') + ' ~ ' + escapeHtml(getEndDate(activity) || '未定') + '</span>';
        if (activity.types) html += renderTypeTags(activity.types);
        html += '</div>';
        html += '<div class="upcoming-card-bottom">';
        html += '<span class="meta-pill ' + (hasRewards(activity) ? 'pill-ok' : 'pill-warning') + '">' + (hasRewards(activity) ? '有奖励配置' : '待补奖励') + '</span>';
        if (changed) html += '<span class="change-mini-badge">刚更新</span>';
        anomalies.forEach(function (flag) {
          html += '<span class="anomaly-badge">' + escapeHtml(anomalyLabel(flag)) + '</span>';
        });
        html += '<button class="inline-action" type="button" data-jump-key="' + escapeAttr(identityKey) + '">定位到日历</button>';
        html += '</div>';
        html += '</article>';
      });

      html += '</div>';
      html += '</section>';
    });

    upcomingGroupsEl.innerHTML = html;
  }

  function renderOperationsView() {
    if (!operationsHeroGridEl || !operationsSummaryEl) return;

    var filtered = getFilteredActivities();
    var stats = buildOperationsStats(filtered, todayKey());
    var summaryLines = summarizeOperations(stats);

    if (!stats.total) {
      operationsHeroGridEl.innerHTML = '';
      operationsPaceEl.innerHTML = '<div class="empty-state">当前筛选范围内没有活动数据。</div>';
      operationsCoverageEl.innerHTML = '';
      operationsTypeBreakdownEl.innerHTML = '';
      operationsSourceBreakdownEl.innerHTML = '';
      operationsSummaryEl.innerHTML = '';
      return;
    }

    var heroCards = [
      { title: '活动总量', value: stats.total, meta: '当前筛选范围内的活动总数', quickView: 'all', targetTab: '__calendar__' },
      { title: '进行中', value: stats.statusCounts.active, meta: '适合查看当前在线活动压力', quickView: 'active', targetTab: '__calendar__' },
      { title: '未来 14 天', value: stats.cadence.next14, meta: '未来两周将开启的活动数', quickView: 'upcoming', targetTab: '__upcoming__' },
      { title: '奖励覆盖率', value: stats.coverage.rewards.pct + '%', meta: stats.coverage.rewards.withCount + ' 个活动已配置奖励' },
      { title: 'Event 绑定率', value: stats.coverage.event.pct + '%', meta: stats.coverage.event.withCount + ' 个活动已绑定 Event' },
      { title: '异常积压', value: stats.anomalies.all, meta: '当前待处理异常活动数', targetTab: '__config__' },
    ];

    var heroHtml = '';
    heroCards.forEach(function (card) {
      heroHtml += '<article class="operations-hero-card">';
      heroHtml += '<div class="operations-hero-title">' + escapeHtml(card.title) + '</div>';
      heroHtml += '<div class="operations-hero-value">' + escapeHtml(String(card.value)) + '</div>';
      heroHtml += '<div class="operations-hero-meta">' + escapeHtml(card.meta) + '</div>';
      if (card.quickView || card.targetTab) {
        heroHtml += '<button class="inline-action" type="button"';
        if (card.quickView) heroHtml += ' data-quick-view="' + escapeAttr(card.quickView) + '"';
        if (card.targetTab) heroHtml += ' data-target-tab="' + escapeAttr(card.targetTab) + '"';
        heroHtml += '>查看明细</button>';
      }
      heroHtml += '</article>';
    });
    operationsHeroGridEl.innerHTML = heroHtml;

    operationsPaceEl.innerHTML = renderOperationsPace(stats);
    operationsCoverageEl.innerHTML = renderOperationsCoverage(stats);
    operationsTypeBreakdownEl.innerHTML = renderBreakdownPanel('类型分布', '看清当前活动主要集中在哪一类，方便调整节奏和资源配置。', stats.breakdowns.types.slice(0, 8));
    operationsSourceBreakdownEl.innerHTML = renderBreakdownPanel('来源分布', '识别当前活动主要来自哪些配置源，便于定位维护重点。', stats.breakdowns.sources.slice(0, 8));
    operationsSummaryEl.innerHTML = renderOperationsSummary(stats, summaryLines);
  }

  function renderInspectionView() {
    renderOpsHealth();
    renderOpsSummary();
    renderOpsAnomalyList();
  }

  function renderOpsHealth() {
    if (!opsHealthEl) return;
    var healthPayload = state.health.healthz || {};
    var readyPayload = state.health.readyz || {};

    var html = '<div class="ops-panel-header"><h3>运行健康</h3><p>直接读取后端健康接口，方便判断当前页面数据是否可信。</p></div>';
    html += '<div class="ops-health-grid">';
    html += renderOpsStat('服务版本', healthPayload.version ? ('v' + healthPayload.version) : '未知', '当前线上代码版本');
    html += renderOpsStat('数据就绪', readyPayload.ready ? '已就绪' : '准备中', readyPayload.ready ? '初始拉取已完成' : '等待首轮数据');
    html += renderOpsStat('最近成功轮询', healthPayload.lastPollSuccessAt ? formatRelativeTime(healthPayload.lastPollSuccessAt) : '暂无', healthPayload.lastPollSuccessAt || '尚未记录轮询结果');
    html += renderOpsStat('快照活动', String(Number(healthPayload.snapshotActivities || 0)), '兜底快照中的活动数');
    html += renderOpsStat('缓存表数', String(Number(healthPayload.cachedSheetCount || 0)), '当前缓存的 Google Sheet 数量');
    html += renderOpsStat('轮询间隔', formatPollInterval(healthPayload.pollIntervalMs), '后端拉取间隔');
    html += '</div>';
    if (healthPayload.lastPollError) {
      html += '<div class="ops-warning">最近轮询报错：' + escapeHtml(healthPayload.lastPollError) + '</div>';
    }
    opsHealthEl.innerHTML = html;
  }

  function renderOpsSummary() {
    if (!opsSummaryEl) return;
    var filtered = getFilteredActivities();
    var counts = countByAnomaly(filtered);

    var html = '<div class="ops-panel-header"><h3>异常摘要</h3><p>基于当前筛选范围统计，方便集中处理未绑定、未分类和奖励缺失问题。</p></div>';
    html += '<div class="ops-summary-grid">';
    html += renderSummaryCard('异常总数', counts.all, '当前筛选范围内的待处理活动');
    html += renderSummaryCard('未配置类型', counts.unconfigured, '无法确认活动分类');
    html += renderSummaryCard('未绑定 Event', counts.missing_event, '没有匹配到 Event 配置');
    html += renderSummaryCard('缺少开始日期', counts.missing_start, '无法进入日历定位');
    html += renderSummaryCard('缺少结束日期', counts.missing_end, '时间跨度仍不完整');
    html += renderSummaryCard('无奖励配置', counts.missing_rewards, '活动已排期但奖励为空');
    html += '</div>';
    opsSummaryEl.innerHTML = html;
  }

  function renderOpsAnomalyList() {
    if (!opsAnomalyListEl) return;

    var activities = getFilteredActivities().filter(function (activity) {
      return getAnomalyFlags(activity).length > 0;
    }).sort(function (a, b) {
      var diff = getAnomalyFlags(b).length - getAnomalyFlags(a).length;
      if (diff !== 0) return diff;
      return compareActivitiesForDisplay(a, b);
    });

    var html = '<div class="ops-panel-header"><h3>待处理活动</h3><p>点击“定位到日历”可以直接跳到对应月份和卡片位置。</p></div>';
    if (activities.length === 0) {
      html += '<div class="empty-state">当前筛选范围内没有异常活动。</div>';
      opsAnomalyListEl.innerHTML = html;
      return;
    }

    var periodMap = buildPeriodIndexMap(state.activities);
    html += '<div class="ops-anomaly-list">';
    activities.forEach(function (activity) {
      var identityKey = activityIdentityKey(activity);
      var stableKey = getStableActivityKey(activity);
      html += '<article class="ops-anomaly-item">';
      html += '<div class="ops-anomaly-top">';
      html += '<div>';
      html += '<h4>' + escapeHtml(getDisplayName(activity, periodMap)) + '</h4>';
      html += '<p>' + escapeHtml(activity.source || '未知来源') + ' · ' + escapeHtml((activity.startDate || '未定') + ' ~ ' + (getEndDate(activity) || '未定')) + '</p>';
      html += '</div>';
      html += '<div class="ops-anomaly-actions">';
      html += '<button class="favorite-toggle' + (isFavorite(activity) ? ' active' : '') + '" type="button" data-favorite-stable-key="' + escapeAttr(stableKey) + '">' + favoriteIcon(isFavorite(activity)) + '</button>';
      html += '<button class="inline-action" type="button" data-jump-key="' + escapeAttr(identityKey) + '">定位到日历</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="ops-anomaly-tags">';
      if (activity.types) html += renderTypeTags(activity.types);
      getAnomalyFlags(activity).forEach(function (flag) {
        html += '<span class="anomaly-badge">' + escapeHtml(anomalyLabel(flag)) + '</span>';
      });
      html += '</div>';
      html += '<div class="ops-anomaly-note">奖励数：' + (activity.rewards ? activity.rewards.length : 0) + '，' + (activity.eventId ? ('Event ' + activity.eventId) : '尚未绑定 Event') + '</div>';
      html += '</article>';
    });
    html += '</div>';
    opsAnomalyListEl.innerHTML = html;
  }

  function renderDrawer() {
    if (!drawerOverlayEl || !drawerEl || !drawerContentEl) return;

    if (!state.drawerStableKey) {
      drawerOverlayEl.classList.remove('open');
      drawerEl.setAttribute('aria-hidden', 'true');
      drawerContentEl.innerHTML = '';
      return;
    }

    var activity = findActivityByStableKey(state.drawerStableKey);
    if (!activity) {
      closeDrawer();
      return;
    }

    var periodMap = buildPeriodIndexMap(state.activities);
    var anomalies = getAnomalyFlags(activity);
    var rewards = Array.isArray(activity.rewards) ? activity.rewards : [];
    var changed = isRecentlyChanged(activity);
    var stableKey = getStableActivityKey(activity);
    var identityKey = activityIdentityKey(activity);
    var html = '<div class="activity-drawer-head">';
    html += '<div class="activity-drawer-kicker">活动详情</div>';
    html += '<h3>' + escapeHtml(getDisplayName(activity, periodMap)) + '</h3>';
    html += '<div class="activity-drawer-meta">';
    html += '<span class="meta-pill status-' + getStatusKey(activity, todayKey()) + '">' + escapeHtml(STATUS_LABELS[getStatusKey(activity, todayKey())]) + '</span>';
    html += '<span class="meta-pill">' + escapeHtml(activity.source || '未知来源') + '</span>';
    if (activity.eventId) html += '<span class="meta-pill">Event ' + escapeHtml(String(activity.eventId)) + '</span>';
    if (changed) html += '<span class="change-mini-badge">刚更新</span>';
    html += '</div>';
    html += '</div>';

    html += '<div class="activity-drawer-actions">';
    html += '<button class="favorite-toggle' + (isFavorite(activity) ? ' active' : '') + '" type="button" data-favorite-stable-key="' + escapeAttr(stableKey) + '">' + favoriteIcon(isFavorite(activity)) + ' 收藏</button>';
    html += '<button class="inline-action" type="button" data-copy-activity-key="' + escapeAttr(identityKey) + '">复制活动摘要</button>';
    html += '<button class="inline-action" type="button" data-jump-key="' + escapeAttr(identityKey) + '">定位到日历</button>';
    html += '</div>';

    html += '<section class="activity-drawer-section">';
    html += '<h4>时间与分类</h4>';
    html += '<div class="activity-drawer-line"><strong>活动周期</strong><span>' + escapeHtml((activity.startDate || '未定') + ' ~ ' + (getEndDate(activity) || '未定')) + '</span></div>';
    if (activity.types && activity.types.length > 0) {
      html += '<div class="activity-drawer-tags">' + renderTypeTags(activity.types) + '</div>';
    }
    html += '</section>';

    html += '<section class="activity-drawer-section">';
    html += '<h4>来源信息</h4>';
    html += '<div class="activity-drawer-line"><strong>来源</strong><span>' + escapeHtml(activity.source || '未知来源') + '</span></div>';
    if (activity.category) html += '<div class="activity-drawer-line"><strong>类别</strong><span>' + escapeHtml(activity.category) + '</span></div>';
    if (activity.excelName) html += '<div class="activity-drawer-line"><strong>Excel 名称</strong><span>' + escapeHtml(activity.excelName) + '</span></div>';
    html += '</section>';

    html += '<section class="activity-drawer-section">';
    html += '<h4>奖励配置</h4>';
    if (rewards.length > 0) {
      html += '<div class="activity-drawer-rewards">';
      rewards.forEach(function (reward) {
        html += '<span class="reward-tag">' + escapeHtml(reward.name || '未命名奖励');
        if (reward.itemId) html += '<code>' + escapeHtml(String(reward.itemId)) + '</code>';
        html += '</span>';
      });
      html += '</div>';
    } else {
      html += '<div class="activity-drawer-empty">当前没有奖励配置。</div>';
    }
    html += '</section>';

    html += '<section class="activity-drawer-section">';
    html += '<h4>巡检结果</h4>';
    if (anomalies.length > 0) {
      html += '<div class="activity-drawer-tags">';
      anomalies.forEach(function (flag) {
        html += '<span class="anomaly-badge">' + escapeHtml(anomalyLabel(flag)) + '</span>';
      });
      html += '</div>';
    } else {
      html += '<div class="activity-drawer-empty">当前没有检测到异常。</div>';
    }
    html += '</section>';

    drawerContentEl.innerHTML = html;
    drawerOverlayEl.classList.add('open');
    drawerEl.setAttribute('aria-hidden', 'false');
  }

  function openDrawer(activity) {
    if (!activity) return;
    state.drawerStableKey = getStableActivityKey(activity);
    renderDrawer();
  }

  function closeDrawer() {
    state.drawerStableKey = '';
    renderDrawer();
  }

  function renderOperationsPace(stats) {
    var cards = [
      { label: '今天覆盖中', value: stats.cadence.today, meta: '今天仍在持续的活动数' },
      { label: '本周覆盖中', value: stats.cadence.thisWeek, meta: '本周任一时间在线的活动数' },
      { label: '本月覆盖中', value: stats.cadence.thisMonth, meta: '本月范围内有排期的活动数' },
      { label: '未来 7 天', value: stats.cadence.next7, meta: '一周内将开启的活动数' },
      { label: '未来 14 天', value: stats.cadence.next14, meta: '两周内将开启的活动数' },
      { label: '未来 30 天', value: stats.cadence.next30, meta: '一个月内将开启的活动数' },
    ];

    var html = '<div class="operations-panel-header"><h3>节奏概览</h3><p>从今天、本周到未来 30 天，快速判断活动密度和排期压力。</p></div>';
    html += '<div class="operations-mini-grid">';
    cards.forEach(function (card) {
      html += '<div class="operations-mini-card">';
      html += '<div class="operations-mini-label">' + escapeHtml(card.label) + '</div>';
      html += '<div class="operations-mini-value">' + escapeHtml(String(card.value)) + '</div>';
      html += '<div class="operations-mini-meta">' + escapeHtml(card.meta) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderOperationsCoverage(stats) {
    var html = '<div class="operations-panel-header"><h3>覆盖率视图</h3><p>奖励、Event、类型和排期完整度一眼看清，方便运营和配置同学对齐补齐动作。</p></div>';
    html += '<div class="operations-coverage-list">';
    html += renderCoverageRow('奖励覆盖率', stats.coverage.rewards.pct, stats.coverage.rewards.withCount + ' / ' + stats.total + ' 个活动有奖励');
    html += renderCoverageRow('Event 绑定率', stats.coverage.event.pct, stats.coverage.event.withCount + ' / ' + stats.total + ' 个活动已绑定');
    html += renderCoverageRow('类型配置率', stats.coverage.typing.pct, stats.coverage.typing.configuredCount + ' / ' + stats.total + ' 个活动已分类');
    html += renderCoverageRow('排期完整率', stats.coverage.schedule.pct, stats.coverage.schedule.completeCount + ' / ' + stats.total + ' 个活动起止日期完整');
    html += '</div>';

    html += '<div class="operations-coverage-footnote">';
    html += '<div class="operations-mini-card"><div class="operations-mini-label">平均周期</div><div class="operations-mini-value">' + escapeHtml(String(stats.durations.averageDays)) + ' 天</div><div class="operations-mini-meta">按已排期活动平均计算</div></div>';
    html += '<div class="operations-mini-card"><div class="operations-mini-label">中位周期</div><div class="operations-mini-value">' + escapeHtml(String(stats.durations.medianDays)) + ' 天</div><div class="operations-mini-meta">更能反映常规活动跨度</div></div>';
    html += '</div>';
    return html;
  }

  function renderBreakdownPanel(title, description, items) {
    var html = '<div class="operations-panel-header"><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(description) + '</p></div>';
    if (!items || items.length === 0) {
      html += '<div class="empty-state">当前没有可展示的数据。</div>';
      return html;
    }

    html += '<div class="operations-breakdown-list">';
    items.forEach(function (item, index) {
      html += '<div class="operations-breakdown-row">';
      html += '<div class="operations-breakdown-head"><strong>' + escapeHtml(item.label) + '</strong><span>' + item.count + ' 个 · ' + item.pct + '%</span></div>';
      html += '<div class="operations-breakdown-bar"><span style="width:' + item.pct + '%;--bar-color:' + COLORS[index % COLORS.length] + '"></span></div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderOperationsSummary(stats, summaryLines) {
    var longestText = stats.durations.longest
      ? ('最长活动：' + ((stats.durations.longest.activity && stats.durations.longest.activity.name) || '未命名活动') + '，' + stats.durations.longest.days + ' 天')
      : '最长活动：暂无数据';

    var html = '<div class="operations-panel-header"><h3>运营摘要</h3><p>把当前筛选范围内的重点结论和下一步动作集中到一张卡里。</p></div>';
    html += '<div class="operations-summary-grid">';
    html += '<div class="operations-summary-copy">';
    html += '<ul class="operations-summary-list">';
    summaryLines.forEach(function (line) {
      html += '<li>' + escapeHtml(line) + '</li>';
    });
    html += '</ul>';
    html += '</div>';
    html += '<div class="operations-summary-aside">';
    html += '<div class="operations-mini-card"><div class="operations-mini-label">最长活动</div><div class="operations-mini-value">' + escapeHtml(String(stats.durations.longest ? stats.durations.longest.days : 0)) + ' 天</div><div class="operations-mini-meta">' + escapeHtml(longestText) + '</div></div>';
    html += '<div class="operations-mini-card"><div class="operations-mini-label">异常待办</div><div class="operations-mini-value">' + escapeHtml(String(stats.anomalies.all)) + '</div><div class="operations-mini-meta">可切到数据巡检页继续处理</div></div>';
    html += '<div class="operations-summary-actions">';
    html += '<button class="inline-action" type="button" data-copy-operations="true">复制运营摘要</button>';
    html += '<button class="inline-action" type="button" data-quick-view="active" data-target-tab="__calendar__">查看进行中</button>';
    html += '<button class="inline-action" type="button" data-target-tab="__config__" data-quick-view="all">去看巡检</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function jumpToActivity(activity) {
    if (!activity) return;
    if (activity.startDate) {
      var startDate = parseDate(activity.startDate);
      if (startDate) {
        state.calYear = startDate.getFullYear();
        state.calMonth = startDate.getMonth();
        state.selectedDate = activity.startDate;
      }
    }
    state.pendingFocusKey = activityIdentityKey(activity);
    state.activeTab = '__calendar__';
    closeDrawer();
    renderAll();
  }

  function focusPendingCard() {
    if (!state.pendingFocusKey) return;
    focusCardByKey(state.pendingFocusKey);
    state.pendingFocusKey = null;
  }

  function focusCardByKey(key) {
    if (!key) return;
    var card = document.querySelector('.activity-card[data-open-key="' + cssEscape(key) + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight');
    setTimeout(function () {
      card.classList.remove('highlight');
    }, 1800);
  }

  function copyCurrentSummary() {
    var filtered = getFilteredActivities().slice().sort(compareActivitiesForDisplay);
    var lines = [
      'GNG 活动摘要',
      '时间：' + new Date().toLocaleString('zh-CN', { hour12: false }),
      '视图：' + (QUICK_VIEW_LABELS[state.quickView] || QUICK_VIEW_LABELS.all),
      '活动数：' + filtered.length,
      '',
    ];

    filtered.slice(0, 30).forEach(function (activity, index) {
      lines.push((index + 1) + '. ' + buildActivitySummaryLine(activity));
    });

    copyText(lines.join('\n'), '已复制当前筛选摘要');
  }

  function copyActivitySummary(activity) {
    if (!activity) return;
    var lines = [
      'GNG 活动详情',
      buildActivitySummaryLine(activity),
      '来源：' + (activity.source || '未知来源'),
      '类型：' + ((activity.types && activity.types.length > 0) ? activity.types.join(' / ') : '未配置'),
      '异常：' + (getAnomalyFlags(activity).length > 0 ? getAnomalyFlags(activity).map(anomalyLabel).join(' / ') : '无'),
      '奖励：' + (hasRewards(activity) ? activity.rewards.map(function (reward) { return reward.name || '未命名奖励'; }).join(' / ') : '无奖励配置'),
    ];
    copyText(lines.join('\n'), '已复制活动摘要');
  }

  function copyOperationsSummary() {
    var stats = buildOperationsStats(getFilteredActivities(), todayKey());
    var lines = ['GNG 运营摘要', '时间：' + new Date().toLocaleString('zh-CN', { hour12: false }), ''];
    summarizeOperations(stats).forEach(function (line, index) {
      lines.push((index + 1) + '. ' + line);
    });
    copyText(lines.join('\n'), '已复制运营摘要');
  }

  function buildActivitySummaryLine(activity) {
    return [
      getDisplayName(activity, buildPeriodIndexMap(state.activities)),
      (activity.startDate || '未定') + ' ~ ' + (getEndDate(activity) || '未定'),
      (activity.types && activity.types.length > 0) ? activity.types.join(' / ') : '未配置',
      hasRewards(activity) ? ('奖励 ' + activity.rewards.length + ' 个') : '无奖励配置'
    ].join(' | ');
  }

  function copyText(text, successMessage) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () {
          showToast(successMessage || '已复制');
        })
        .catch(function () {
          fallbackCopy(text, successMessage);
        });
      return;
    }
    fallbackCopy(text, successMessage);
  }

  function fallbackCopy(text, successMessage) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast(successMessage || '已复制');
    } catch (err) {
      console.error('Copy failed:', err);
      showToast('复制失败，请稍后重试');
    }
    document.body.removeChild(textarea);
  }

  function showToast(message) {
    var toast = document.getElementById('floating-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'floating-toast';
      toast.className = 'floating-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('show');
    }, 1800);
  }

  function getFilteredActivities(options) {
    var settings = options || {};
    var filtered = state.activities.slice();
    var formFilters = {
      search: state.filters.search,
      status: state.filters.status,
      source: state.filters.source,
      rewards: state.filters.rewards,
      anomaly: state.filters.anomaly,
    };

    if (settings.includeFormFilters !== false) {
      filtered = filterActivities(filtered, formFilters, todayKey());
    }

    if (settings.includeQuickView !== false) {
      filtered = filtered.filter(function (activity) {
        return matchesQuickView(activity, state.quickView);
      });
    }

    if (settings.includeTypeFilter !== false) {
      filtered = filtered.filter(matchesTypeFilter);
    }

    return filtered;
  }

  function matchesQuickView(activity, quickView) {
    var today = parseDate(todayKey());
    if (!today) return true;
    var todayStr = todayKey();
    var weekStart = dateKey(startOfWeek(today));
    var weekEnd = dateKey(endOfWeek(today));
    var monthStart = dateKey(startOfMonth(today));
    var monthEnd = dateKey(endOfMonth(today));

    switch (quickView) {
      case 'today':
        return overlapsRange(activity, todayStr, todayStr);
      case 'week':
        return overlapsRange(activity, weekStart, weekEnd);
      case 'month':
        return overlapsRange(activity, monthStart, monthEnd);
      case 'active':
        return getStatusKey(activity, todayStr) === 'active';
      case 'upcoming':
        return getStatusKey(activity, todayStr) === 'upcoming';
      case 'favorites':
        return isFavorite(activity);
      case 'all':
      default:
        return true;
    }
  }

  function countQuickViewActivities(activities, quickView) {
    return (activities || []).filter(function (activity) {
      return matchesQuickView(activity, quickView);
    }).length;
  }

  function matchesTypeFilter(activity) {
    if (state.activeTypeFilter === 'all') return true;
    if (!Array.isArray(activity.types)) return false;
    return activity.types.some(function (typeName) {
      return TYPE_FILTER_KEY[typeName] === state.activeTypeFilter;
    });
  }

  function getTypeCounts(activities) {
    var counts = { all: activities.length };
    activities.forEach(function (activity) {
      if (!Array.isArray(activity.types)) return;
      activity.types.forEach(function (typeName) {
        var key = TYPE_FILTER_KEY[typeName];
        if (key) counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  function assignColors() {
    state.activities.forEach(function (activity) {
      if (!activityColorMap[activity.name]) {
        activityColorMap[activity.name] = COLORS[colorIndex % COLORS.length];
        colorIndex += 1;
      }
    });
  }

  function getColor(name) {
    return activityColorMap[name] || '#999';
  }

  function buildHealthError(results) {
    var messages = [];
    if (results[1] && results[1].status === 'rejected') messages.push('healthz 获取失败');
    if (results[2] && results[2].status === 'rejected') messages.push('readyz 获取失败');
    return messages.join('，');
  }

  function fetchCalendarData() {
    return fetch('/api/calendar', {
      headers: {
        'X-Next-Path': buildCurrentPath(),
      },
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (payload) {
        if (res.status === 401 || payload.error === 'authentication_required') {
          throw buildAuthRequiredError(payload, 'Your session expired. Please sign in again.');
        }
        if (!res.ok) throw new Error(payload.error || 'calendar fetch failed');
        return payload;
      });
    });
  }

  function fetchHealthPayload(url) {
    return fetch(url).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (payload) {
        payload.__ok = res.ok;
        payload.__statusCode = res.status;
        return payload;
      });
    });
  }

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gng-theme', theme);
    if (themeToggle) themeToggle.innerHTML = theme === 'light' ? '&#x2728;' : '&#9790;';
  }

  function setStatus(stateName, text) {
    if (!statusEl || !statusLabel) return;
    statusEl.className = 'status ' + stateName;
    statusLabel.textContent = text;
  }

  function renderFooterTimestamp() {
    if (!updateTimeEl) return;
    if (!state.lastUpdatedAt) {
      updateTimeEl.textContent = '最近更新：等待首次加载';
      return;
    }
    updateTimeEl.textContent = '最近更新：' + new Date(state.lastUpdatedAt).toLocaleString('zh-CN', { hour12: false });
  }

  function renderTypeTags(types) {
    if (!types || types.length === 0) return '';
    return types.map(function (typeName) {
      return '<span class="type-tag ' + (TYPE_CSS[typeName] || '') + '">' + escapeHtml(typeName) + '</span>';
    }).join('');
  }

  function renderOpsStat(label, value, meta) {
    return '<div class="ops-stat"><div class="ops-stat-label">' + escapeHtml(label) + '</div><div class="ops-stat-value">' + escapeHtml(value) + '</div><div class="ops-stat-meta">' + escapeHtml(meta) + '</div></div>';
  }

  function renderSummaryCard(label, value, meta) {
    return '<div class="ops-summary-card"><div class="ops-summary-label">' + escapeHtml(label) + '</div><div class="ops-summary-value">' + escapeHtml(String(value)) + '</div><div class="ops-summary-meta">' + escapeHtml(meta) + '</div></div>';
  }

  function renderCoverageRow(label, pct, meta) {
    var html = '<div class="operations-coverage-row">';
    html += '<div class="operations-coverage-head"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(String(pct)) + '%</span></div>';
    html += '<div class="operations-coverage-bar"><span style="width:' + pct + '%"></span></div>';
    html += '<div class="operations-coverage-meta">' + escapeHtml(meta) + '</div>';
    html += '</div>';
    return html;
  }

  function activityIdentityKey(activity) {
    if (activityDisplay.activityIdentityKey) return activityDisplay.activityIdentityKey(activity);
    return [
      activity && activity.name || '',
      activity && activity.startDate || '',
      activity && activity.endDate || '',
      activity && activity.source || '',
      activity && activity.category || '',
    ].join('|');
  }

  function buildPeriodIndexMap(activities) {
    if (activityDisplay.buildPeriodIndexMap) return activityDisplay.buildPeriodIndexMap(activities);
    return {};
  }

  function getDisplayName(activity, periodMap) {
    if (activityDisplay.getDisplayName) return activityDisplay.getDisplayName(activity, periodMap);
    return (activity && activity.name) || '';
  }

  function filterActivities(activities, filters, todayStr) {
    return activityInsights.filterActivities ? activityInsights.filterActivities(activities, filters, todayStr) : (activities || []);
  }

  function buildUpcomingGroups(activities, rangeDays, todayStr) {
    return activityInsights.buildUpcomingGroups ? activityInsights.buildUpcomingGroups(activities, rangeDays, todayStr) : [];
  }

  function countByAnomaly(activities) {
    return activityInsights.countByAnomaly ? activityInsights.countByAnomaly(activities) : { all: 0, unconfigured: 0, missing_event: 0, missing_start: 0, missing_end: 0, missing_rewards: 0 };
  }

  function listSources(activities) {
    return activityInsights.listSources ? activityInsights.listSources(activities) : [];
  }

  function getAnomalyFlags(activity) {
    return activityInsights.getAnomalyFlags ? activityInsights.getAnomalyFlags(activity) : [];
  }

  function getStatusKey(activity, todayStr) {
    return activityInsights.getStatusKey ? activityInsights.getStatusKey(activity, todayStr) : 'undated';
  }

  function getEndDate(activity) {
    return activityInsights.getEndDate ? activityInsights.getEndDate(activity) : ((activity && (activity.endDate || activity.startDate)) || '');
  }

  function hasRewards(activity) {
    return activityInsights.hasRewards ? activityInsights.hasRewards(activity) : !!(activity && activity.rewards && activity.rewards.length);
  }

  function parseDate(dateStr) {
    return activityInsights.parseDate ? activityInsights.parseDate(dateStr) : null;
  }

  function addDays(date, days) {
    return activityInsights.addDays ? activityInsights.addDays(date, days) : null;
  }

  function startOfWeek(date) {
    return activityInsights.startOfWeek ? activityInsights.startOfWeek(date) : date;
  }

  function endOfWeek(date) {
    return activityInsights.endOfWeek ? activityInsights.endOfWeek(date) : date;
  }

  function startOfMonth(date) {
    return activityInsights.startOfMonth ? activityInsights.startOfMonth(date) : date;
  }

  function endOfMonth(date) {
    return activityInsights.endOfMonth ? activityInsights.endOfMonth(date) : date;
  }

  function overlapsRange(activity, startStr, endStr) {
    return activityInsights.overlapsRange ? activityInsights.overlapsRange(activity, startStr, endStr) : false;
  }

  function getStableActivityKey(activity) {
    return activityInsights.getStableActivityKey ? activityInsights.getStableActivityKey(activity) : activityIdentityKey(activity);
  }

  function buildOperationsStats(activities, todayStr) {
    return activityInsights.buildOperationsStats ? activityInsights.buildOperationsStats(activities, todayStr) : { total: 0 };
  }

  function summarizeOperations(stats) {
    return activityInsights.summarizeOperations ? activityInsights.summarizeOperations(stats) : [];
  }

  function diffActivityLists(previous, next) {
    return activityInsights.diffActivityLists ? activityInsights.diffActivityLists(previous, next) : { summary: { total: 0 }, entries: [], changedStableKeys: [] };
  }

  function dateKey(date) {
    return activityInsights.dateKey ? activityInsights.dateKey(date) : '';
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function anomalyLabel(flag) {
    return (activityInsights.ANOMALY_LABELS || {})[flag] || flag;
  }

  function getActivitiesForDate(activities, dateStr) {
    return (activities || []).filter(function (activity) {
      return activity.startDate && activity.startDate <= dateStr && getEndDate(activity) >= dateStr;
    });
  }

  function findActivityByKey(key) {
    for (var index = 0; index < state.activities.length; index += 1) {
      if (activityIdentityKey(state.activities[index]) === key) return state.activities[index];
    }
    return null;
  }

  function findActivityByStableKey(stableKey) {
    for (var index = 0; index < state.activities.length; index += 1) {
      if (getStableActivityKey(state.activities[index]) === stableKey) return state.activities[index];
    }
    return null;
  }

  function compareActivitiesForDisplay(a, b) {
    var aStatus = statusRank(getStatusKey(a, todayKey()));
    var bStatus = statusRank(getStatusKey(b, todayKey()));
    if (aStatus !== bStatus) return aStatus - bStatus;
    var aStart = String((a && a.startDate) || '');
    var bStart = String((b && b.startDate) || '');
    if (aStart !== bStart) return aStart.localeCompare(bStart);
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'zh-CN');
  }

  function statusRank(status) {
    switch (status) {
      case 'active': return 0;
      case 'upcoming': return 1;
      case 'undated': return 2;
      default: return 3;
    }
  }

  function isRecentlyChanged(activity) {
    if (!state.recentChanges || !state.recentChanges.changedStableKeys) return false;
    return state.recentChanges.changedStableKeys.indexOf(getStableActivityKey(activity)) !== -1;
  }

  function loadFavoriteKeys() {
    try {
      var raw = localStorage.getItem('gng-favorites');
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }

  function saveFavoriteKeys() {
    localStorage.setItem('gng-favorites', JSON.stringify(state.favoriteKeys));
  }

  function isFavorite(activity) {
    return state.favoriteKeys.indexOf(getStableActivityKey(activity)) !== -1;
  }

  function toggleFavorite(stableKey) {
    var index = state.favoriteKeys.indexOf(stableKey);
    if (index === -1) state.favoriteKeys.push(stableKey);
    else state.favoriteKeys.splice(index, 1);
    saveFavoriteKeys();
    renderAll();
  }

  function favoriteIcon(active) {
    return active ? '★' : '☆';
  }

  function restoreStateFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var tab = params.get('tab');
    var quickView = params.get('quick');
    var type = params.get('type');
    var range = parseInt(params.get('range'), 10);
    var month = params.get('month');
    var selectedDate = params.get('date');

    if (tab && TAB_DEFS.some(function (item) { return item.key === tab; })) state.activeTab = tab;
    if (quickView && QUICK_VIEW_DEFS.some(function (item) { return item.key === quickView; })) state.quickView = quickView;
    if (type && (type === 'all' || FILTER_LABELS[type])) state.activeTypeFilter = type;
    if (!Number.isNaN(range) && [7, 14, 30].indexOf(range) !== -1) state.upcomingRange = range;

    state.filters.search = params.get('q') || '';
    state.filters.status = params.get('status') || 'all';
    state.filters.source = params.get('source') || 'all';
    state.filters.rewards = params.get('rewards') || 'all';
    state.filters.anomaly = params.get('anomaly') || 'all';
    state.selectedDate = selectedDate || null;

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      state.calYear = parseInt(month.slice(0, 4), 10);
      state.calMonth = parseInt(month.slice(5, 7), 10) - 1;
    }
  }

  function syncUrlState() {
    var params = new URLSearchParams();
    if (state.activeTab !== '__calendar__') params.set('tab', state.activeTab);
    if (state.quickView !== 'all') params.set('quick', state.quickView);
    if (state.activeTypeFilter !== 'all') params.set('type', state.activeTypeFilter);
    if (state.filters.search) params.set('q', state.filters.search);
    if (state.filters.status !== 'all') params.set('status', state.filters.status);
    if (state.filters.source !== 'all') params.set('source', state.filters.source);
    if (state.filters.rewards !== 'all') params.set('rewards', state.filters.rewards);
    if (state.filters.anomaly !== 'all') params.set('anomaly', state.filters.anomaly);
    if (state.upcomingRange !== 14) params.set('range', String(state.upcomingRange));
    if (state.calYear != null && state.calMonth != null) params.set('month', state.calYear + '-' + String(state.calMonth + 1).padStart(2, '0'));
    if (state.selectedDate) params.set('date', state.selectedDate);
    var next = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
    window.history.replaceState(null, '', next);
  }

  function diffFromToday(dateStr) {
    var date = parseDate(dateStr);
    var today = parseDate(todayKey());
    if (!date || !today) return '待开始';
    var diff = Math.round((date.getTime() - today.getTime()) / 86400000);
    if (diff <= 0) return '今天开始';
    if (diff === 1) return '明天开始';
    return diff + ' 天后开始';
  }

  function formatDisplayDate(dateStr) {
    var date = parseDate(dateStr);
    if (!date) return dateStr || '未定';
    return date.toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    });
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return '暂无';
    var timestamp = new Date(isoString).getTime();
    if (Number.isNaN(timestamp)) return isoString;
    var diff = Date.now() - timestamp;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }

  function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '';
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 24) {
      var days = Math.floor(hours / 24);
      return days + ' 天 ' + (hours % 24) + ' 小时';
    }
    if (hours > 0) return hours + ' 小时 ' + minutes + ' 分钟';
    return Math.max(minutes, 1) + ' 分钟';
  }

  function formatPollInterval(ms) {
    if (!ms) return '未知';
    if (ms >= 60000) return Math.round(ms / 60000) + ' 分钟';
    return Math.round(ms / 1000) + ' 秒';
  }

  function fmtDate(year, month, day) {
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }
})();
