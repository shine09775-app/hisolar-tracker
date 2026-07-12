const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return 'application/json';
      },
    },
    async text() {
      return JSON.stringify(payload ?? {});
    },
    async json() {
      return payload ?? {};
    },
  };
}

function createFakeTimers() {
  let nextId = 1;
  const tasks = new Map();

  return {
    clearTimeout(id) {
      tasks.delete(id);
    },
    setTimeout(fn, delay) {
      const id = nextId++;
      tasks.set(id, { fn, delay });
      return id;
    },
    async runAll() {
      while (tasks.size) {
        const [id, task] = tasks.entries().next().value;
        tasks.delete(id);
        await task.fn();
      }
    },
  };
}

function createMockSupabaseClient() {
  const createdChannels = [];
  const removedChannels = [];
  const stats = { setAuthCount: 0 };

  return {
    createdChannels,
    removedChannels,
    stats,
    async removeAllChannels() {
      removedChannels.push(...createdChannels.map(channel => channel.name));
      return [];
    },
    async removeChannel(channel) {
      removedChannels.push(channel.name);
      return 'ok';
    },
    channel(name) {
      const handlers = {};
      const channel = {
        name,
        on(eventName, _filter, callback) {
          handlers[eventName] = callback;
          return channel;
        },
        subscribe(callback) {
          handlers.subscribe = callback;
          return channel;
        },
        emitStatus(status, error = null) {
          if (handlers.subscribe) handlers.subscribe(status, error);
        },
        emitChange(payload = {}) {
          if (handlers.postgres_changes) handlers.postgres_changes(payload);
        },
      };
      createdChannels.push(channel);
      return channel;
    },
    realtime: {
      async setAuth() {
        stats.setAuthCount += 1;
      },
      connectionState() {
        return 'open';
      },
    },
  };
}

function createHarness() {
  const timers = createFakeTimers();
  const fetchQueue = [];
  const fetchCalls = [];
  const createClientCalls = [];
  const windowEvents = [];

  const document = {
    head: { appendChild() {} },
    createElement() { return {}; },
    getElementById() { return null; },
    querySelector() { return null; },
  };

  const window = {
    location: {
      origin: 'https://tracker.example',
      href: 'https://tracker.example/index.html',
      search: '',
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    dispatchEvent(event) {
      windowEvents.push(event);
    },
    supabase: {
      createClient(url, key, options) {
        const client = createMockSupabaseClient();
        createClientCalls.push({ url, key, options, client });
        return client;
      },
    },
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'line-auth-client.js'), 'utf8');
  const context = vm.createContext({
    URL,
    URLSearchParams,
    console,
    clearTimeout: timers.clearTimeout.bind(timers),
    document,
    fetch: async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      const response = fetchQueue.shift();
      if (!response) throw new Error(`Unexpected fetch for ${url}`);
      if (response instanceof Error) throw response;
      return response;
    },
    setTimeout: timers.setTimeout.bind(timers),
    window,
  });
  vm.runInContext(source, context, { filename: 'line-auth-client.js' });

  return {
    api: window.HiSolarAuth,
    createClientCalls,
    fetchCalls,
    fetchQueue,
    timers,
    windowEvents,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('Supabase browser client is wired to publishable key plus authenticated token callback', async () => {
  const harness = createHarness();
  const client = harness.api.createSupabaseClient(
    'hisolar',
    'https://example.supabase.co',
    'sb_publishable_test'
  );

  assert.equal(harness.createClientCalls.length, 1);
  assert.equal(harness.createClientCalls[0].key, 'sb_publishable_test');
  assert.equal(client, harness.createClientCalls[0].client);

  harness.fetchQueue.push(jsonResponse(200, {
    app: 'hisolar',
    expiresAt: '2099-01-01T00:00:00.000Z',
    token: 'jwt-1',
  }));

  const token = await harness.createClientCalls[0].options.accessToken();
  assert.equal(token, 'jwt-1');
  assert.match(harness.fetchCalls[0].url, /\/api\/auth\/token\?app=hisolar$/);
  assert.equal(harness.fetchCalls[0].options.credentials, 'include');
});

test('Realtime controller blocks duplicate start and auth failure marks cached token unusable', async () => {
  const harness = createHarness();
  const client = harness.api.createSupabaseClient(
    'hisolar',
    'https://example.supabase.co',
    'sb_publishable_test'
  );

  harness.fetchQueue.push(jsonResponse(200, {
    app: 'hisolar',
    expiresAt: '2099-01-01T00:00:00.000Z',
    token: 'jwt-prime',
  }));
  await harness.api.refreshSupabaseToken('hisolar', { forceRefresh: true, reason: 'prime' });

  const events = [];
  const unsubscribe = harness.api.onSupabaseAuthEvent('hisolar', event => events.push(event));

  const controller = harness.api.createRealtimeController({
    app: 'hisolar',
    client,
    tableNames: ['hi_solar_jobs', 'hi_solar_job_comments'],
    debounceMs: 200,
    onReloadRequested() {},
  });

  await controller.start();
  await controller.start();
  assert.equal(client.createdChannels.length, 2);

  harness.fetchQueue.push(jsonResponse(403, {
    error: 'Membership is not approved for this app',
  }));
  await assert.rejects(
    () => harness.api.refreshSupabaseToken('hisolar', { forceRefresh: true, reason: 'scheduled' }),
    /Membership is not approved/
  );
  await flushMicrotasks();
  await harness.timers.runAll();

  const tokenErrorEvent = events.find(event => event.type === 'token_error');
  assert.ok(tokenErrorEvent);
  assert.equal(tokenErrorEvent.tokenStillUsable, false);
  unsubscribe();
});

test('Frontends gate auth before data load and JDK uses publishable-key authenticated setup', () => {
  const planner = fs.readFileSync(path.join(__dirname, '..', 'hisolar_planner.html'), 'utf8');
  const jdk = fs.readFileSync(path.join(__dirname, '..', 'JDK.html'), 'utf8');

  assert.match(planner, /refreshSupabaseToken\('hisolar', \{ forceRefresh: true, reason: 'prime' \}\)/);
  assert.match(planner, /const loaded = await loadData\(\{ throwOnError: true \}\);\s*if \(!loaded\) return;\s*setupRealtime\(\);/s);

  assert.doesNotMatch(jdk, /SUPABASE_ANON_KEY/);
  assert.match(jdk, /refreshSupabaseToken\('jdk', \{ forceRefresh: true, reason: 'prime' \}\)/);
  assert.match(jdk, /createSupabaseClient\('jdk', SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY\)/);
  assert.match(jdk, /const loaded = await loadData\(\{ throwOnError: true \}\);\s*if \(!loaded\) return;\s*setupRealtime\(\);/s);
});

test('Database cutover files lock comment identity to auth claims and remove legacy anon policies', () => {
  const foundation = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'line-auth-foundation.sql'), 'utf8');
  const cutover = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'line-auth-cutover.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'line-auth-cutover-rollback.sql'), 'utf8');

  assert.match(foundation, /if auth\.uid\(\) is not null then\s+new\.actor_user_id := auth\.uid\(\);/s);
  assert.match(foundation, /new\.author_name_snapshot := resolved_display_name;/);
  assert.match(foundation, /new\.author_picture_url_snapshot := resolved_picture_url;/);
  assert.match(foundation, /new\.organization := claim_org;/);
  assert.match(foundation, /and actor_user_id = auth\.uid\(\)\s+and organization = public\.current_request_organization\(\)/s);

  for (const policyName of [
    'Public read jobs',
    'Public insert jobs',
    'Public update jobs',
    'Public update gcal sync',
    'Public read comments',
    'Public insert comments',
    'Public read logs',
    'Public read permits',
    'Public insert permits',
    'Public update permits',
    'Public read permit logs',
    'Public insert permit logs',
  ]) {
    assert.match(cutover, new RegExp(`drop policy if exists "${policyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(rollback, new RegExp(`create policy "${policyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});
