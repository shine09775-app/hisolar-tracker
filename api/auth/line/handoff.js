const { resolveMembershipAccess } = require('../../_lib/auth-rules');
const { getAppConfig, getSessionMaxAgeSeconds } = require('../../_lib/config');
const { methodNotAllowed, sendError, writeJson } = require('../../_lib/http');
const { sha256Base64Url } = require('../../_lib/security');
const { createSessionToken, hashSessionToken, setSessionCookie } = require('../../_lib/session');
const {
  createAuthSession,
  getLoginFlowByHandoff,
  getRequestIpHash,
  listMembershipsForUser,
  takeCompletedLoginFlow,
} = require('../../_lib/supabase-admin');

// The home-screen app (iOS standalone) keeps its own cookies, apart from Safari
// and LINE's in-app browser. It opens LINE Login in another browser, keeps the
// raw secret to itself, and polls here; once the callback has finished the
// login in that other browser, this hands the home-screen app its own session.
// Only the hash of the secret ever left the app, inside the start URL.

const HANDOFF_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function readSecret(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_error) {
      body = null;
    }
  }
  const secret = String((body && body.secret) || '').trim();
  return HANDOFF_SECRET_PATTERN.test(secret) ? secret : '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const secret = readSecret(req);
    if (!secret) {
      return writeJson(res, 400, { error: 'Invalid handoff secret' });
    }

    const flow = await getLoginFlowByHandoff(sha256Base64Url(secret));
    if (!flow || !flow.completed_user_id) {
      return writeJson(res, 200, { status: 'waiting' });
    }

    const config = getAppConfig(flow.app);
    if (flow.completed_outcome === 'pending') {
      return writeJson(res, 200, { status: 'pending', redirect: config.pendingPath });
    }

    if (!(await takeCompletedLoginFlow(flow.state_hash))) {
      // Another poll collected it first.
      return writeJson(res, 200, { status: 'waiting' });
    }

    // Membership may have changed since the callback; check it again.
    const access = resolveMembershipAccess(flow.app, await listMembershipsForUser(flow.completed_user_id));
    if (access.outcome !== 'approved') {
      return writeJson(res, 403, { error: 'Membership is not approved for this app' });
    }

    const sessionToken = createSessionToken();
    await createAuthSession({
      userId: flow.completed_user_id,
      app: flow.app,
      sessionTokenHash: hashSessionToken(sessionToken),
      userAgent: req.headers['user-agent'] || null,
      ipHash: getRequestIpHash(req),
      expiresAt: new Date(Date.now() + getSessionMaxAgeSeconds() * 1000).toISOString(),
    });
    setSessionCookie(res, sessionToken);
    return writeJson(res, 200, { status: 'approved', redirect: flow.return_to || config.successPath });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports.readSecret = readSecret;
