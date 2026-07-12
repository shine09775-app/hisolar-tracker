const { URL, URLSearchParams } = require('url');
const { createHttpError } = require('./http');

const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY_ID_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/verify';

async function readResponseBody(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { text };
  }
}

function buildAuthorizeUrl({ channelId, callbackUrl, state, nonce, codeChallenge }) {
  const url = new URL(LINE_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', channelId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function exchangeCodeForTokens({ code, codeVerifier, callbackUrl, channelId, channelSecret }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl,
    client_id: channelId,
    client_secret: channelSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(LINE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await readResponseBody(res);
  if (!res.ok) {
    throw createHttpError(502, 'LINE token exchange failed', payload);
  }
  if (!payload || !payload.id_token) {
    throw createHttpError(502, 'LINE token exchange did not return an ID token');
  }
  return payload;
}

async function verifyIdToken({ idToken, accessToken, channelId, nonce }) {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
    nonce,
  });
  if (accessToken) body.set('access_token', accessToken);
  const res = await fetch(LINE_VERIFY_ID_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await readResponseBody(res);
  if (!res.ok) {
    throw createHttpError(502, 'LINE ID token verification failed', payload);
  }
  if (!payload || payload.aud !== channelId || payload.nonce !== nonce || !payload.sub) {
    throw createHttpError(502, 'LINE ID token verification returned invalid claims', payload);
  }
  return {
    raw: payload,
    lineUserId: String(payload.sub),
    displayName: payload.name ? String(payload.name) : '',
    pictureUrl: payload.picture ? String(payload.picture) : null,
  };
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  verifyIdToken,
};
