const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTH_SESSION_SECRET = 'test-secret-for-auth-flow';

const { createFlowState, setFlowCookie } = require('../api/_lib/auth-flow');
const { setSessionCookie } = require('../api/_lib/session');
const { buildAuthorizeUrl } = require('../api/_lib/line-login');

function createMockResponse() {
  const headers = new Map();
  return {
    getHeader(name) {
      return headers.get(name);
    },
    setHeader(name, value) {
      headers.set(name, value);
    },
  };
}

test('LINE authorize URL includes openid profile, nonce, and PKCE S256 challenge', () => {
  const flow = createFlowState({ app: 'hisolar', returnTo: '/hisolar_planner.html' });
  const url = new URL(buildAuthorizeUrl({
    channelId: 'channel-id',
    callbackUrl: 'https://tracker.example/api/auth/line/callback',
    state: flow.state,
    nonce: flow.nonce,
    codeChallenge: flow.codeChallenge,
  }));

  assert.equal(url.origin, 'https://access.line.me');
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.equal(url.searchParams.get('nonce'), flow.nonce);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), flow.codeChallenge);
});

test('flow and session cookies are HttpOnly, Secure, and SameSite=Lax', () => {
  const flow = createFlowState({ app: 'hisolar', returnTo: '/hisolar_planner.html' });

  const flowRes = createMockResponse();
  setFlowCookie(flowRes, flow.cookieValue, flow.expiresAt);
  const flowCookie = String(flowRes.getHeader('Set-Cookie'));
  assert.match(flowCookie, /HttpOnly/);
  assert.match(flowCookie, /Secure/);
  assert.match(flowCookie, /SameSite=Lax/);
  assert.match(flowCookie, /Path=\//);

  const sessionRes = createMockResponse();
  setSessionCookie(sessionRes, 'session-token', 600);
  const sessionCookie = String(sessionRes.getHeader('Set-Cookie'));
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(sessionCookie, /Max-Age=600/);
});
