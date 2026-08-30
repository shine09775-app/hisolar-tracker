const { getAuthenticatedSessionContext } = require('../_lib/auth-context');
const { normalizeApp } = require('../_lib/config');
const { clearSessionCookie } = require('../_lib/session');
const { methodNotAllowed, normalizeQueryValue, sendError, writeJson } = require('../_lib/http');
const { signSupabaseAccessToken } = require('../_lib/supabase-jwt');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const app = normalizeApp(normalizeQueryValue(req.query && req.query.app)) || undefined;
    const context = await getAuthenticatedSessionContext(req, app, res);
    const token = await signSupabaseAccessToken(context);
    return writeJson(res, 200, {
      app: context.targetApp,
      expiresAt: token.expiresAt,
      token: token.token,
    });
  } catch (error) {
    if (error && error.statusCode === 401) clearSessionCookie(res);
    return sendError(res, error);
  }
};
