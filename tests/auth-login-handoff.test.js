const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.AUTH_SESSION_SECRET = 'test-secret-for-auth-flow';
process.env.LINE_LOGIN_CHANNEL_ID = 'shared-channel';
process.env.LINE_LOGIN_CHANNEL_SECRET = 'shared-secret';
process.env.LINE_LOGIN_CALLBACK_URL = 'https://example.com/api/auth/line/callback';
process.env.LINE_LOGIN_PROVIDER_NAMESPACE = 'hisolar-tracker-line';

const authFlow = require('../api/_lib/auth-flow');
const config = require('../api/_lib/config');
// Other test files may swap these modules in require.cache, so stubs name the
// module path and are applied to whatever is cached when the handler loads.
const lineLogin = '../api/_lib/line-login';
const supabaseAdmin = '../api/_lib/supabase-admin';
const { sha256Base64Url } = require('../api/_lib/security');
const { getCanonicalStartUrl } = require('../api/auth/line/start');

const base64url = bytes => Buffer.from(bytes).toString('base64url');

// Loads a handler with stubbed Supabase / LINE calls. Handlers destructure their
// helpers at require time, so the stubs are swapped in only while requiring and
// the shared modules are restored for the other test files.
function loadHandler(relativePath, stubs) {
  const handlerPath = require.resolve(relativePath);
  const originals = [];
  for (const [modulePath, overrides] of stubs) {
    const mod = require(modulePath);
    for (const [key, value] of Object.entries(overrides)) {
      originals.push([mod, key, mod[key]]);
      mod[key] = value;
    }
  }
  delete require.cache[handlerPath];
  try {
    return require(handlerPath);
  } finally {
    delete require.cache[handlerPath];
    originals.reverse().forEach(([mod, key, value]) => {
      mod[key] = value;
    });
  }
}

function createMockResponse() {
  const headers = new Map();
  return {
    body: '',
    statusCode: 200,
    getHeader: name => headers.get(name.toLowerCase()),
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end(body) {
      this.body = body || '';
    },
  };
}

function setCookies(res) {
  const value = res.getHeader('Set-Cookie');
  return Array.isArray(value) ? value : value ? [value] : [];
}

function storedRowFor(flow, extra = {}) {
  return {
    state_hash: authFlow.hashLoginState(flow.state),
    app: flow.app,
    return_to: flow.returnTo,
    nonce: flow.nonce,
    code_verifier: flow.codeVerifier,
    handoff_hash: null,
    ...extra,
  };
}

function callbackStubs(overrides = {}) {
  const calls = { claimed: [], completed: [], sessions: [], exchanged: [] };
  const admin = {
    claimLoginFlow: async stateHash => {
      calls.claimed.push(stateHash);
      return overrides.storedFlow || null;
    },
    completeLoginFlow: async (stateHash, details) => {
      calls.completed.push({ stateHash, ...details });
    },
    createAuthSession: async session => {
      calls.sessions.push(session);
      return { id: 'session-1' };
    },
    ensureJdkAutoApprovedMembership: async () => {},
    ensurePendingAccessRequest: async () => {},
    getRequestIpHash: () => null,
    listMembershipsForUser: async () => overrides.memberships || [
      { organization: 'hisolar', status: 'approved', role: 'member' },
    ],
    upsertAppUserProfile: async () => ({ id: 'user-1' }),
  };
  const line = {
    exchangeCodeForTokens: async args => {
      calls.exchanged.push(args);
      return { id_token: 'id', access_token: 'access' };
    },
    verifyIdToken: async () => ({ lineUserId: 'U1', displayName: 'Tester', pictureUrl: null }),
  };
  return { calls, stubs: [[supabaseAdmin, admin], [lineLogin, line]] };
}

test('session lasts 180 days by default and still honours the env override', () => {
  const original = process.env.AUTH_SESSION_MAX_AGE_SECONDS;
  delete process.env.AUTH_SESSION_MAX_AGE_SECONDS;
  try {
    assert.equal(config.getSessionMaxAgeSeconds(), 180 * 24 * 60 * 60);
    process.env.AUTH_SESSION_MAX_AGE_SECONDS = '3600';
    assert.equal(config.getSessionMaxAgeSeconds(), 3600);
  } finally {
    if (original === undefined) delete process.env.AUTH_SESSION_MAX_AGE_SECONDS;
    else process.env.AUTH_SESSION_MAX_AGE_SECONDS = original;
  }
});

test('handoff hash must look like base64url SHA-256', () => {
  const hash = sha256Base64Url('secret');
  assert.equal(authFlow.normalizeHandoffHash(hash), hash);
  assert.equal(authFlow.normalizeHandoffHash('short'), null);
  assert.equal(authFlow.normalizeHandoffHash(`${hash}x`), null);
  assert.equal(authFlow.normalizeHandoffHash(''), null);
});

test('canonical start redirect keeps the handoff hash', () => {
  const hash = sha256Base64Url('secret');
  const url = new URL(getCanonicalStartUrl(
    { headers: { host: 'deployment-id.vercel.app' } },
    { callbackUrl: 'https://branch-alias.vercel.app/api/auth/line/callback' },
    'hisolar',
    '/home.html',
    hash
  ));
  assert.equal(url.host, 'branch-alias.vercel.app');
  assert.equal(url.searchParams.get('handoff'), hash);
});

test('callback prefers the cookie flow, falls back to the stored row, else nothing', () => {
  const { resolveFlowState } = loadHandler('../api/auth/line/callback', []);
  const flow = authFlow.createFlowState({ app: 'hisolar', returnTo: '/home.html' });
  const cookieFlow = authFlow.decodeFlowCookieValue(flow.cookieValue);
  const stored = storedRowFor(flow);

  assert.equal(resolveFlowState(cookieFlow, stored, flow.state), cookieFlow);
  assert.deepEqual(resolveFlowState(null, stored, flow.state), {
    app: 'hisolar',
    returnTo: '/home.html',
    nonce: flow.nonce,
    codeVerifier: flow.codeVerifier,
  });
  assert.equal(resolveFlowState(null, null, flow.state), null);
  assert.equal(resolveFlowState(cookieFlow, null, 'other-state'), null);
});

test('callback without the flow cookie finishes from the stored row (LINE in-app browser)', async () => {
  const flow = authFlow.createFlowState({ app: 'hisolar', returnTo: '/sites.html' });
  const { calls, stubs } = callbackStubs({ storedFlow: storedRowFor(flow) });
  const handler = loadHandler('../api/auth/line/callback', stubs);
  const res = createMockResponse();

  await handler({ method: 'GET', headers: {}, query: { code: 'abc', state: flow.state } }, res);

  assert.equal(res.statusCode, 302);
  assert.equal(res.getHeader('Location'), '/sites.html');
  assert.deepEqual(calls.claimed, [authFlow.hashLoginState(flow.state)]);
  assert.equal(calls.exchanged[0].codeVerifier, flow.codeVerifier);
  assert.equal(calls.sessions.length, 1);
  assert.ok(setCookies(res).some(cookie => cookie.startsWith('hs_session=')));
  assert.equal(calls.completed.length, 0);
});

test('callback with an unknown or reused state shows a Thai retry page, not plain text', async () => {
  const flow = authFlow.createFlowState({ app: 'hisolar', returnTo: '/home.html' });
  const { calls, stubs } = callbackStubs({ storedFlow: null });
  const handler = loadHandler('../api/auth/line/callback', stubs);
  const res = createMockResponse();

  await handler({ method: 'GET', headers: {}, query: { code: 'abc', state: flow.state } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.getHeader('Content-Type'), /text\/html/);
  assert.match(res.body, /ลิงก์เข้าสู่ระบบหมดอายุ/);
  assert.match(res.body, /href="\/index\.html"/);
  assert.equal(calls.exchanged.length, 0);
});

test('handoff login is marked complete for the home-screen app to collect', async () => {
  const flow = authFlow.createFlowState({ app: 'hisolar', returnTo: '/home.html' });
  const handoffHash = sha256Base64Url('secret');
  const { calls, stubs } = callbackStubs({ storedFlow: storedRowFor(flow, { handoff_hash: handoffHash }) });
  const handler = loadHandler('../api/auth/line/callback', stubs);
  const res = createMockResponse();

  await handler({ method: 'GET', headers: {}, query: { code: 'abc', state: flow.state } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /เข้าสู่ระบบสำเร็จ/);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].userId, 'user-1');
  assert.equal(calls.completed[0].outcome, 'approved');
});

function handoffStubs({ flow, taken = true, memberships }) {
  const calls = { sessions: [], lookedUp: [] };
  const admin = {
    createAuthSession: async session => {
      calls.sessions.push(session);
      return { id: 'session-2' };
    },
    getLoginFlowByHandoff: async hash => {
      calls.lookedUp.push(hash);
      return flow;
    },
    getRequestIpHash: () => null,
    listMembershipsForUser: async () => memberships || [
      { organization: 'hisolar', status: 'approved', role: 'member' },
    ],
    takeCompletedLoginFlow: async () => taken,
  };
  return { calls, stubs: [[supabaseAdmin, admin]] };
}

test('handoff poll hands the home-screen app its own session exactly once', async () => {
  const secret = base64url(crypto.randomBytes(32));
  const { calls, stubs } = handoffStubs({
    flow: { state_hash: 'h', app: 'hisolar', return_to: '/home.html', completed_user_id: 'user-1', completed_outcome: 'approved' },
  });
  const handler = loadHandler('../api/auth/line/handoff', stubs);
  const res = createMockResponse();

  await handler({ method: 'POST', headers: {}, body: { secret } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { status: 'approved', redirect: '/home.html' });
  assert.deepEqual(calls.lookedUp, [sha256Base64Url(secret)]);
  assert.equal(calls.sessions.length, 1);
  assert.ok(setCookies(res).some(cookie => cookie.startsWith('hs_session=')));
});

test('handoff poll waits while the login is unfinished or already collected', async () => {
  const secret = base64url(crypto.randomBytes(32));
  for (const scenario of [
    { flow: null },
    { flow: { state_hash: 'h', app: 'hisolar', completed_user_id: null } },
    { flow: { state_hash: 'h', app: 'hisolar', completed_user_id: 'user-1', completed_outcome: 'approved' }, taken: false },
  ]) {
    const { calls, stubs } = handoffStubs(scenario);
    const handler = loadHandler('../api/auth/line/handoff', stubs);
    const res = createMockResponse();
    await handler({ method: 'POST', headers: {}, body: { secret } }, res);
    assert.deepEqual(JSON.parse(res.body), { status: 'waiting' });
    assert.equal(calls.sessions.length, 0);
  }
});

test('handoff poll rechecks membership and rejects bad secrets', async () => {
  const secret = base64url(crypto.randomBytes(32));
  const revoked = handoffStubs({
    flow: { state_hash: 'h', app: 'hisolar', completed_user_id: 'user-1', completed_outcome: 'approved' },
    memberships: [{ organization: 'hisolar', status: 'revoked', role: 'member' }],
  });
  const handler = loadHandler('../api/auth/line/handoff', revoked.stubs);
  const res = createMockResponse();
  await handler({ method: 'POST', headers: {}, body: { secret } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(revoked.calls.sessions.length, 0);

  const bad = createMockResponse();
  await handler({ method: 'POST', headers: {}, body: { secret: 'too-short' } }, bad);
  assert.equal(bad.statusCode, 400);
});
