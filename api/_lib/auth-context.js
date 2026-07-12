const { createHttpError } = require('./http');
const { isSessionActive } = require('./auth-rules');
const { normalizeApp } = require('./config');
const {
  getAppUserById,
  getAuthSessionByHash,
  listMembershipsForUser,
  touchAuthSession,
} = require('./supabase-admin');
const { hashSessionToken, readSessionTokenFromRequest } = require('./session');

async function getAuthenticatedSessionContext(req, requestedApp) {
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

  await touchAuthSession(session.id);

  return {
    membership,
    memberships,
    session,
    sessionTokenHash,
    targetApp,
    user,
  };
}

module.exports = {
  getAuthenticatedSessionContext,
};
