const { createHttpError } = require('./http');
const { isSessionActive } = require('./auth-rules');
const { getSessionMaxAgeSeconds, normalizeApp } = require('./config');
const {
  getAppUserById,
  getAuthSessionByHash,
  listMembershipsForUser,
  touchAuthSession,
} = require('./supabase-admin');
const { hashSessionToken, readSessionTokenFromRequest, setSessionCookie } = require('./session');

// Sliding session: every authenticated request pushes expires_at back out and
// re-issues the cookie, so an account in daily use never hits the ceiling.
// Only someone absent for the full window in a row is asked to sign in again.
async function getAuthenticatedSessionContext(req, requestedApp, res) {
  const sessionToken = readSessionTokenFromRequest(req);
  if (!sessionToken) {
    throw createHttpError(401, 'Authentication required');
  }

  const sessionTokenHash = hashSessionToken(sessionToken);
  const session = await getAuthSessionByHash(sessionTokenHash);
  if (!isSessionActive(session)) {
    throw createHttpError(401, 'Session expired or invalid');
  }

  const user = await getAppUserById(session.user_id);
  if (!user) {
    throw createHttpError(401, 'Session user not found');
  }

  const memberships = await listMembershipsForUser(session.user_id);
  const targetApp = requestedApp ? normalizeApp(requestedApp) : session.app;
  if (!targetApp) {
    throw createHttpError(400, 'Invalid app');
  }

  const membership = memberships.find(item => item.organization === targetApp) || null;
  if (!membership || membership.status !== 'approved') {
    throw createHttpError(403, 'Membership is not approved for this app');
  }

  const maxAgeSeconds = getSessionMaxAgeSeconds();
  const renewedExpiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  await touchAuthSession(session.id, renewedExpiresAt);
  if (res) {
    setSessionCookie(res, sessionToken, maxAgeSeconds);
  }

  return {
    membership,
    memberships,
    session: { ...session, expires_at: renewedExpiresAt },
    sessionTokenHash,
    targetApp,
    user,
  };
}

module.exports = {
  getAuthenticatedSessionContext,
};
