const { getCookieNames, getSessionMaxAgeSeconds } = require('./config');
const { appendSetCookie, parseCookies, serializeCookie } = require('./cookies');
const { randomBase64Url, sha256Hex } = require('./security');

function createSessionToken() {
  return randomBase64Url(32);
}

function hashSessionToken(token) {
  return sha256Hex(token);
}

function readSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return cookies[getCookieNames().session] || '';
}

function setSessionCookie(res, sessionToken, maxAgeSeconds = getSessionMaxAgeSeconds()) {
  appendSetCookie(
    res,
    serializeCookie(getCookieNames().session, sessionToken, {
      expires: new Date(Date.now() + maxAgeSeconds * 1000),
      httpOnly: true,
      maxAge: maxAgeSeconds,
      path: '/',
      sameSite: 'Lax',
      secure: true,
    })
  );
}

function clearSessionCookie(res) {
  appendSetCookie(
    res,
    serializeCookie(getCookieNames().session, '', {
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
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  readSessionTokenFromRequest,
  setSessionCookie,
};
