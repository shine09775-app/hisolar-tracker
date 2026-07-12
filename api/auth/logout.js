const { clearFlowCookie } = require('../_lib/auth-flow');
const { methodNotAllowed, sendError, writeJson } = require('../_lib/http');
const { revokeAuthSessionByHash } = require('../_lib/supabase-admin');
const { clearSessionCookie, hashSessionToken, readSessionTokenFromRequest } = require('../_lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const sessionToken = readSessionTokenFromRequest(req);
    if (sessionToken) {
      await revokeAuthSessionByHash(hashSessionToken(sessionToken));
    }
    clearFlowCookie(res);
    clearSessionCookie(res);
    return writeJson(res, 200, { success: true });
  } catch (error) {
    return sendError(res, error);
  }
};
