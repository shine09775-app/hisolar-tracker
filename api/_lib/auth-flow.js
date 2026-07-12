const { getAuthCookieSecret, getCookieNames } = require('./config');
const { appendSetCookie, parseCookies, serializeCookie } = require('./cookies');
const { createPkcePair, randomBase64Url, signValue, verifySignedValue } = require('./security');

const FLOW_MAX_AGE_SECONDS = 10 * 60;

function createFlowState({ app, returnTo }) {
  const state = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const { codeVerifier, codeChallenge } = createPkcePair();
  const expiresAt = Date.now() + FLOW_MAX_AGE_SECONDS * 1000;
  const payload = {
    app,
    returnTo,
    state,
    nonce,
    codeVerifier,
    exp: Math.floor(expiresAt / 1000),
  };
  const cookieValue = signValue(payload, getAuthCookieSecret());
  return {
    app,
    codeChallenge,
    codeVerifier,
    cookieValue,
    expiresAt,
    nonce,
    returnTo,
    state,
  };
}

function decodeFlowCookieValue(cookieValue, nowMs = Date.now()) {
  const payload = verifySignedValue(cookieValue, getAuthCookieSecret());
  if (!payload || !payload.exp || payload.exp * 1000 <= nowMs) return null;
  return payload;
}

function readFlowStateFromRequest(req, nowMs = Date.now()) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return decodeFlowCookieValue(cookies[getCookieNames().flow], nowMs);
}

function setFlowCookie(res, cookieValue, expiresAt) {
  appendSetCookie(
    res,
    serializeCookie(getCookieNames().flow, cookieValue, {
      expires: new Date(expiresAt),
      httpOnly: true,
      maxAge: FLOW_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'Lax',
      secure: true,
    })
  );
}

function clearFlowCookie(res) {
  appendSetCookie(
    res,
    serializeCookie(getCookieNames().flow, '', {
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'Lax',
      secure: true,
    })
  );
}

module.exports = {
  clearFlowCookie,
  createFlowState,
  decodeFlowCookieValue,
  readFlowStateFromRequest,
  setFlowCookie,
};
