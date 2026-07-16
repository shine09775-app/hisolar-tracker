const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTH_SESSION_SECRET = 'test-secret-for-auth-flow';
process.env.LINE_LOGIN_CHANNEL_ID = 'shared-channel';
process.env.LINE_LOGIN_CHANNEL_SECRET = 'shared-secret';
process.env.LINE_LOGIN_CALLBACK_URL = 'https://example.com/api/auth/line/callback';
process.env.LINE_LOGIN_PROVIDER_NAMESPACE = 'hisolar-tracker-line';

const { createFlowState, decodeFlowCookieValue } = require('../api/_lib/auth-flow');
const { resolveMembershipAccess, isSessionActive } = require('../api/_lib/auth-rules');
const { getAppConfig, resolveReturnTo } = require('../api/_lib/config');

test('state and nonce are random, long enough, and survive signed-cookie decode', () => {
  const first = createFlowState({ app: 'hisolar', returnTo: '/hisolar_planner.html' });
  const second = createFlowState({ app: 'hisolar', returnTo: '/hisolar_planner.html' });

  assert.notStrictEqual(first.state, second.state);
  assert.notStrictEqual(first.nonce, second.nonce);
  assert.ok(first.state.length >= 40);
  assert.ok(first.nonce.length >= 40);

  const decoded = decodeFlowCookieValue(first.cookieValue);
  assert.equal(decoded.app, 'hisolar');
  assert.equal(decoded.returnTo, '/hisolar_planner.html');
  assert.equal(decoded.state, first.state);
  assert.equal(decoded.nonce, first.nonce);
});

test('resolveMembershipAccess enforces approved, pending, and wrong-app outcomes', () => {
  const approved = resolveMembershipAccess('hisolar', [
    { organization: 'hisolar', role: 'member', status: 'approved' },
  ]);
  assert.equal(approved.outcome, 'approved');

  const pending = resolveMembershipAccess('hisolar', [
    { organization: 'hisolar', role: 'member', status: 'pending' },
  ]);
  assert.equal(pending.outcome, 'pending');

  const wrongApp = resolveMembershipAccess('hisolar', [
    { organization: 'jdk', role: 'commenter', status: 'approved' },
  ]);
  assert.equal(wrongApp.outcome, 'wrong_app');
});

test('isSessionActive rejects revoked and expired sessions', () => {
  const now = Date.parse('2026-07-11T10:00:00.000Z');
  assert.equal(
    isSessionActive({ expires_at: '2026-07-11T10:10:00.000Z', revoked_at: null }, now),
    true
  );
  assert.equal(
    isSessionActive({ expires_at: '2026-07-11T09:59:59.000Z', revoked_at: null }, now),
    false
  );
  assert.equal(
    isSessionActive({ expires_at: '2026-07-11T10:10:00.000Z', revoked_at: '2026-07-11T10:00:00.000Z' }, now),
    false
  );
});

test('resolveReturnTo only allows fixed internal targets', () => {
  assert.equal(resolveReturnTo('hisolar', '/hisolar_planner.html'), '/hisolar_planner.html');
  assert.throws(
    () => resolveReturnTo('hisolar', 'https://evil.example/phish'),
    /Invalid return_to|not allowed/
  );
  assert.throws(
    () => resolveReturnTo('hisolar', '/JDK.html'),
    /not allowed/
  );
});

test('Hi Solar and JDK share one LINE Login configuration but keep separate success paths', () => {
  const hisolar = getAppConfig('hisolar');
  const jdk = getAppConfig('jdk');

  assert.equal(hisolar.channelId, 'shared-channel');
  assert.equal(jdk.channelId, 'shared-channel');
  assert.equal(hisolar.channelSecret, 'shared-secret');
  assert.equal(jdk.channelSecret, 'shared-secret');
  assert.equal(hisolar.callbackUrl, 'https://example.com/api/auth/line/callback');
  assert.equal(jdk.callbackUrl, 'https://example.com/api/auth/line/callback');
  assert.equal(hisolar.providerNamespace, 'hisolar-tracker-line');
  assert.equal(jdk.providerNamespace, 'hisolar-tracker-line');
  assert.equal(hisolar.successPath, '/hisolar_planner.html');
  assert.equal(jdk.successPath, '/JDK.html');
});

test('shared LINE Login config can fall back to legacy Hi Solar env names for Vercel previews', () => {
  const original = {
    id: process.env.LINE_LOGIN_CHANNEL_ID,
    secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
    callback: process.env.LINE_LOGIN_CALLBACK_URL,
    legacyId: process.env.LINE_LOGIN_HISOLAR_CHANNEL_ID,
    legacySecret: process.env.LINE_LOGIN_HISOLAR_CHANNEL_SECRET,
    legacyCallback: process.env.LINE_LOGIN_HISOLAR_CALLBACK_URL,
  };

  delete process.env.LINE_LOGIN_CHANNEL_ID;
  delete process.env.LINE_LOGIN_CHANNEL_SECRET;
  delete process.env.LINE_LOGIN_CALLBACK_URL;
  process.env.LINE_LOGIN_HISOLAR_CHANNEL_ID = 'legacy-hisolar-channel';
  process.env.LINE_LOGIN_HISOLAR_CHANNEL_SECRET = 'legacy-hisolar-secret';
  process.env.LINE_LOGIN_HISOLAR_CALLBACK_URL = 'https://legacy.example/api/auth/line/callback';

  try {
    const hisolar = getAppConfig('hisolar');
    const jdk = getAppConfig('jdk');
    assert.equal(hisolar.channelId, 'legacy-hisolar-channel');
    assert.equal(jdk.channelId, 'legacy-hisolar-channel');
    assert.equal(hisolar.channelSecret, 'legacy-hisolar-secret');
    assert.equal(jdk.channelSecret, 'legacy-hisolar-secret');
    assert.equal(hisolar.callbackUrl, 'https://legacy.example/api/auth/line/callback');
    assert.equal(jdk.callbackUrl, 'https://legacy.example/api/auth/line/callback');
  } finally {
    process.env.LINE_LOGIN_CHANNEL_ID = original.id;
    process.env.LINE_LOGIN_CHANNEL_SECRET = original.secret;
    process.env.LINE_LOGIN_CALLBACK_URL = original.callback;
    if (original.legacyId === undefined) delete process.env.LINE_LOGIN_HISOLAR_CHANNEL_ID;
    else process.env.LINE_LOGIN_HISOLAR_CHANNEL_ID = original.legacyId;
    if (original.legacySecret === undefined) delete process.env.LINE_LOGIN_HISOLAR_CHANNEL_SECRET;
    else process.env.LINE_LOGIN_HISOLAR_CHANNEL_SECRET = original.legacySecret;
    if (original.legacyCallback === undefined) delete process.env.LINE_LOGIN_HISOLAR_CALLBACK_URL;
    else process.env.LINE_LOGIN_HISOLAR_CALLBACK_URL = original.legacyCallback;
  }
});
