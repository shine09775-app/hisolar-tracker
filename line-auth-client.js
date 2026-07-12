(function () {
  const SUPABASE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  const TOKEN_REFRESH_SKEW_MS = 60000;
  const TOKEN_RETRY_DELAY_MS = 10000;
  const TOKEN_MIN_REFRESH_DELAY_MS = 5000;

  const supabaseApps = Object.create(null);
  let supabaseClientLoadPromise = null;

  function buildApiUrl(path, params) {
    const url = new URL(path, window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_error) {
      return { raw: text };
    }
  }

  async function requestJson(url, options) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options && options.headers ? options.headers : {}),
      },
      ...options,
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const error = new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  function normalizeApp(app) {
    return String(app || '').trim().toLowerCase();
  }

  function isAuthFailure(error) {
    const text = String(error?.message || error?.payload?.error || '').toLowerCase();
    return error?.status === 401 || error?.status === 403 || /authentication required|session expired|membership is not approved|http 401|http 403/.test(text);
  }

  function getSupabaseAppContext(app) {
    const key = normalizeApp(app);
    if (!key) {
      throw new Error('Supabase app is required');
    }
    if (!supabaseApps[key]) {
      supabaseApps[key] = {
        app: key,
        client: null,
        clientConfigKey: '',
        expiresAtMs: 0,
        listeners: new Set(),
        refreshPromise: null,
        refreshTimerId: null,
        token: null,
      };
    }
    return supabaseApps[key];
  }

  function emitSupabaseAppEvent(context, type, detail = {}) {
    const payload = { app: context.app, type, ...detail };
    context.listeners.forEach(listener => {
      try {
        listener(payload);
      } catch (error) {
        console.error('supabase app listener failed', error);
      }
    });
    if (typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new window.CustomEvent('hisolar-auth-event', { detail: payload }));
    }
  }

  function clearRefreshTimer(context) {
    if (context.refreshTimerId) {
      clearTimeout(context.refreshTimerId);
      context.refreshTimerId = null;
    }
  }

  function hasUsableToken(context, nowMs = Date.now()) {
    return Boolean(context.token) && context.expiresAtMs - TOKEN_MIN_REFRESH_DELAY_MS > nowMs;
  }

  function getRefreshLeadMs(ttlMs) {
    return Math.min(TOKEN_REFRESH_SKEW_MS, Math.max(15000, Math.floor(ttlMs / 3)));
  }

  function scheduleRetryRefresh(context) {
    clearRefreshTimer(context);
    context.refreshTimerId = setTimeout(() => {
      void refreshSupabaseToken(context.app, { forceRefresh: true, reason: 'retry' }).catch(() => {});
    }, TOKEN_RETRY_DELAY_MS);
  }

  function scheduleTokenRefresh(context) {
    clearRefreshTimer(context);
    if (!hasUsableToken(context)) return;
    const ttlMs = Math.max(0, context.expiresAtMs - Date.now());
    const delayMs = Math.max(TOKEN_MIN_REFRESH_DELAY_MS, ttlMs - getRefreshLeadMs(ttlMs));
    context.refreshTimerId = setTimeout(() => {
      void refreshSupabaseToken(context.app, { forceRefresh: true, reason: 'scheduled' }).catch(() => {});
    }, delayMs);
  }

  async function syncRealtimeAuth(context, reason = 'sync') {
    if (!context.client?.realtime?.setAuth) return;
    await context.client.realtime.setAuth();
    emitSupabaseAppEvent(context, 'realtime_auth_synced', { reason });
  }

  async function fetchAuthMe(app) {
    return requestJson(buildApiUrl('/api/auth/me', { app }));
  }

  async function refreshSupabaseToken(app, options = {}) {
    const context = getSupabaseAppContext(app);
    const nowMs = Date.now();
    if (!options.forceRefresh && hasUsableToken(context, nowMs) && context.expiresAtMs - TOKEN_REFRESH_SKEW_MS > nowMs) {
      return {
        app: context.app,
        cached: true,
        expiresAt: new Date(context.expiresAtMs).toISOString(),
        expiresAtMs: context.expiresAtMs,
        token: context.token,
      };
    }
    if (context.refreshPromise) {
      return context.refreshPromise;
    }

    context.refreshPromise = (async () => {
      const previousToken = context.token;
      const payload = await requestJson(buildApiUrl('/api/auth/token', { app: context.app }));
      const expiresAtMs = new Date(payload.expiresAt).getTime();

      if (!payload.token || !Number.isFinite(expiresAtMs)) {
        throw new Error('Invalid Supabase token response');
      }

      context.token = payload.token;
      context.expiresAtMs = expiresAtMs;
      scheduleTokenRefresh(context);

      try {
        await syncRealtimeAuth(context, options.reason || 'refresh');
      } catch (error) {
        console.warn('syncRealtimeAuth failed', error);
      }

      emitSupabaseAppEvent(context, 'token_refreshed', {
        changed: previousToken !== context.token,
        expiresAt: payload.expiresAt,
        expiresAtMs,
        reason: options.reason || 'refresh',
        token: context.token,
      });

      return {
        app: context.app,
        cached: false,
        expiresAt: payload.expiresAt,
        expiresAtMs,
        token: context.token,
      };
    })().catch(error => {
      const authFailure = isAuthFailure(error);
      const tokenStillUsable = !authFailure && hasUsableToken(context);
      if (!tokenStillUsable) {
        clearRefreshTimer(context);
        context.token = null;
        context.expiresAtMs = 0;
      } else {
        scheduleRetryRefresh(context);
      }
      emitSupabaseAppEvent(context, 'token_error', {
        error,
        reason: options.reason || 'refresh',
        tokenStillUsable,
      });
      throw error;
    }).finally(() => {
      context.refreshPromise = null;
    });

    return context.refreshPromise;
  }

  async function fetchSupabaseToken(app, options = {}) {
    const result = await refreshSupabaseToken(app, options);
    return result.token;
  }

  function onSupabaseAuthEvent(app, listener) {
    const context = getSupabaseAppContext(app);
    context.listeners.add(listener);
    return () => {
      context.listeners.delete(listener);
    };
  }

  function getRealtimeConnectionState(app) {
    const context = getSupabaseAppContext(app);
    return context.client?.realtime?.connectionState?.() || 'closed';
  }

  function ensureSupabaseClientLoaded() {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      return Promise.resolve(window.supabase);
    }
    if (supabaseClientLoadPromise) return supabaseClientLoadPromise;
    supabaseClientLoadPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${SUPABASE_CDN_URL}"]`);
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.supabase), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Failed to load Supabase client')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = SUPABASE_CDN_URL;
      script.async = true;
      script.onload = () => resolve(window.supabase);
      script.onerror = () => reject(new Error('Failed to load Supabase client'));
      document.head.appendChild(script);
    }).then(result => {
      if (!result || typeof result.createClient !== 'function') {
        throw new Error('Supabase client is not available');
      }
      return result;
    });
    return supabaseClientLoadPromise;
  }

  function createSupabaseClient(app, supabaseUrl, supabasePublishableKey) {
    const createClient = window.supabase && window.supabase.createClient;
    if (!createClient) {
      throw new Error('Supabase client is not available');
    }

    const context = getSupabaseAppContext(app);
    const configKey = `${supabaseUrl}|${supabasePublishableKey}`;
    if (context.client && context.clientConfigKey === configKey) {
      return context.client;
    }

    if (context.client?.removeAllChannels) {
      context.client.removeAllChannels().catch(() => {});
    }

    context.client = createClient(supabaseUrl, supabasePublishableKey, {
      accessToken: async () => fetchSupabaseToken(context.app, { reason: 'access_token_callback' }),
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    context.clientConfigKey = configKey;
    return context.client;
  }

  function createRealtimeController(options) {
    const app = normalizeApp(options.app);
    const client = options.client;
    const tableNames = Array.isArray(options.tableNames) ? options.tableNames.filter(Boolean) : [];
    const channelPrefix = options.channelPrefix || 'rt';
    const debounceMs = Math.max(50, Number(options.debounceMs || 300));
    const onReloadRequested = typeof options.onReloadRequested === 'function' ? options.onReloadRequested : null;
    const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
    const onAuthFailure = typeof options.onAuthFailure === 'function' ? options.onAuthFailure : null;

    if (!app) throw new Error('Realtime app is required');
    if (!client) throw new Error('Realtime client is required');

    let active = false;
    let channels = [];
    let currentState = 'offline';
    let reloadTimerId = null;
    let restartingPromise = null;
    let startPromise = null;
    let stopped = false;
    let unsubscribeTokenEvents = null;
    const channelStates = new Map();

    function setState(nextState, detail) {
      currentState = nextState;
      if (onStateChange) onStateChange(nextState, detail || null);
    }

    function updateAggregateState(detail) {
      if (stopped) return;
      if (!channels.length) {
        setState('offline', detail);
        return;
      }
      const states = [...channelStates.values()];
      if (states.length === tableNames.length && states.every(state => state === 'SUBSCRIBED')) {
        setState('live', detail);
        return;
      }
      setState('reconnecting', detail);
    }

    function scheduleReload(reason) {
      if (!onReloadRequested || stopped) return;
      if (reloadTimerId) clearTimeout(reloadTimerId);
      reloadTimerId = setTimeout(() => {
        reloadTimerId = null;
        Promise.resolve(onReloadRequested(reason)).catch(error => {
          console.error('realtime reload failed', error);
        });
      }, debounceMs);
    }

    async function removeChannels() {
      if (reloadTimerId) {
        clearTimeout(reloadTimerId);
        reloadTimerId = null;
      }
      const currentChannels = channels.slice();
      channels = [];
      channelStates.clear();
      active = false;
      if (currentChannels.length) {
        await Promise.all(currentChannels.map(channel => client.removeChannel(channel).catch(() => null)));
      }
      if (!stopped) {
        setState('offline', { reason: 'channels_removed' });
      }
    }

    function handleAuthFailure(error, detail = {}) {
      if (!onAuthFailure) return false;
      if (!isAuthFailure(error)) return false;
      Promise.resolve(onAuthFailure(error, detail)).catch(listenerError => {
        console.error('realtime auth failure handler failed', listenerError);
      });
      return true;
    }

    function buildChannel(tableName) {
      const channel = client.channel(`${channelPrefix}_${app}_${tableName}`);
      channelStates.set(tableName, 'JOINING');
      channel.on('postgres_changes', { event: '*', schema: 'public', table: tableName }, payload => {
        scheduleReload({ source: 'realtime', tableName, payload });
      });
      channel.subscribe((status, error) => {
        channelStates.set(tableName, status);
        const detail = { error: error || null, status, tableName };
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (error && handleAuthFailure(error, detail)) {
            setState('offline', detail);
            return;
          }
          updateAggregateState(detail);
          return;
        }
        if (status === 'CLOSED') {
          updateAggregateState(detail);
          return;
        }
        if (status === 'SUBSCRIBED') {
          active = true;
        }
        updateAggregateState(detail);
      });
      return channel;
    }

    async function start() {
      if (stopped) return;
      if (channels.length) return startPromise || Promise.resolve();
      if (startPromise) return startPromise;

      if (!unsubscribeTokenEvents) {
        unsubscribeTokenEvents = onSupabaseAuthEvent(app, event => {
          if (stopped) return;
          if (event.type === 'token_refreshed' && event.reason !== 'prime') {
            void reconnect('token_refreshed');
            return;
          }
          if (event.type === 'token_error') {
            if (event.tokenStillUsable) {
              setState('reconnecting', { error: event.error || null, reason: event.reason || 'token_error' });
              return;
            }
            if (!handleAuthFailure(event.error, { reason: event.reason || 'token_error' })) {
              setState('offline', { error: event.error || null, reason: event.reason || 'token_error' });
            }
          }
        });
      }

      startPromise = Promise.resolve().then(() => {
        setState('reconnecting', { reason: 'start' });
        channels = tableNames.map(buildChannel);
      }).finally(() => {
        startPromise = null;
      });
      return startPromise;
    }

    async function reconnect(reason = 'manual') {
      if (stopped) return;
      if (restartingPromise) return restartingPromise;
      restartingPromise = (async () => {
        setState('reconnecting', { reason });
        await removeChannels();
        await client.realtime.setAuth();
        channels = tableNames.map(buildChannel);
      })().catch(error => {
        if (!handleAuthFailure(error, { reason })) {
          setState('offline', { error, reason });
          throw error;
        }
      }).finally(() => {
        restartingPromise = null;
      });
      return restartingPromise;
    }

    async function stop() {
      if (stopped) return;
      stopped = true;
      if (unsubscribeTokenEvents) {
        unsubscribeTokenEvents();
        unsubscribeTokenEvents = null;
      }
      await removeChannels();
      setState('offline', { reason: 'stopped' });
    }

    return {
      getState: () => currentState,
      reconnect,
      start,
      stop,
    };
  }

  async function destroySupabaseApp(app, options = {}) {
    const key = normalizeApp(app);
    if (!key || !supabaseApps[key]) return;
    const context = supabaseApps[key];
    clearRefreshTimer(context);
    if (context.client?.removeAllChannels && options.removeChannels !== false) {
      try {
        await context.client.removeAllChannels();
      } catch (_error) {
        // Best effort cleanup.
      }
    }
    context.client = null;
    context.clientConfigKey = '';
    if (options.clearToken !== false) {
      context.token = null;
      context.expiresAtMs = 0;
    }
    emitSupabaseAppEvent(context, 'destroyed', { reason: options.reason || 'destroy' });
  }

  async function destroyAllSupabaseApps(options = {}) {
    const apps = Object.keys(supabaseApps);
    for (const app of apps) {
      await destroySupabaseApp(app, options);
    }
  }

  function startLineLogin(app, returnTo) {
    window.location.href = buildApiUrl('/api/auth/line/start', {
      app,
      return_to: returnTo,
    });
  }

  async function logout(redirectTo) {
    try {
      await destroyAllSupabaseApps({ reason: 'logout', clearToken: true });
      await requestJson('/api/auth/logout', { method: 'POST' });
    } catch (_error) {
      // Swallow logout transport errors and continue redirect.
    } finally {
      if (redirectTo) {
        window.location.href = redirectTo;
      }
    }
  }

  function setElementHtml(target, html) {
    if (!target) return;
    target.innerHTML = html;
  }

  function renderAuthPanel(target, options) {
    setElementHtml(
      target,
      `
        <div class="name-box">
          ${options.icon ? `<div class="text-center mb-3"><i class="${options.icon}" style="font-size:2.4rem;color:#f59e0b;"></i></div>` : ''}
          <div class="login-title">${options.title || ''}</div>
          ${options.text ? `<div class="login-sub">${options.text}</div>` : ''}
          ${options.detail ? `<div class="small text-muted mt-2">${options.detail}</div>` : ''}
          <div class="d-grid gap-2 mt-3">
            ${(options.actions || []).map(action => `
              <button type="button" class="${action.className || 'btn btn-primary'}" data-auth-action="${action.id}">
                ${action.label}
              </button>
            `).join('')}
          </div>
        </div>
      `
    );
    (options.actions || []).forEach(action => {
      const button = target.querySelector(`[data-auth-action="${action.id}"]`);
      if (button) {
        button.addEventListener('click', action.onClick);
      }
    });
  }

  function applyUserSummary(options) {
    const pictureEl = options.pictureEl ? document.getElementById(options.pictureEl) : null;
    const nameEl = options.nameEl ? document.getElementById(options.nameEl) : null;
    const roleEl = options.roleEl ? document.getElementById(options.roleEl) : null;
    const userChipEl = options.userChipEl ? document.getElementById(options.userChipEl) : null;
    const user = options.user || {};
    const membership = options.membership || {};

    if (pictureEl) {
      if (user.pictureUrl) {
        pictureEl.src = user.pictureUrl;
        pictureEl.style.display = 'block';
      } else {
        pictureEl.style.display = 'none';
      }
    }
    if (nameEl) {
      nameEl.textContent = user.displayName || '-';
    }
    if (roleEl) {
      roleEl.textContent = membership.role ? String(membership.role).toUpperCase() : '-';
    }
    if (userChipEl) {
      userChipEl.textContent = user.displayName || '-';
    }
  }

  window.HiSolarAuth = {
    applyUserSummary,
    createRealtimeController,
    createSupabaseClient,
    destroyAllSupabaseApps,
    destroySupabaseApp,
    ensureSupabaseClientLoaded,
    fetchAuthMe,
    fetchSupabaseToken,
    getQueryParam,
    getRealtimeConnectionState,
    logout,
    onSupabaseAuthEvent,
    refreshSupabaseToken,
    renderAuthPanel,
    requestJson,
    startLineLogin,
  };
})();
