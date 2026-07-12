const { clearFlowCookie, readFlowStateFromRequest } = require('../../_lib/auth-flow');
const { getAppConfig, getSessionMaxAgeSeconds } = require('../../_lib/config');
const { resolveMembershipAccess } = require('../../_lib/auth-rules');
const { methodNotAllowed, normalizeQueryValue, redirect, sendError, writeText } = require('../../_lib/http');
const { exchangeCodeForTokens, verifyIdToken } = require('../../_lib/line-login');
const {
  createAuthSession,
  ensurePendingAccessRequest,
  getRequestIpHash,
  listMembershipsForUser,
  upsertAppUserProfile,
} = require('../../_lib/supabase-admin');
const { createSessionToken, hashSessionToken, setSessionCookie } = require('../../_lib/session');
const { timingSafeEqualText } = require('../../_lib/security');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const flowState = readFlowStateFromRequest(req);
    clearFlowCookie(res);

    if (!flowState) {
      return writeText(res, 400, 'Login attempt is missing or expired');
    }

    const returnedError = normalizeQueryValue(req.query && req.query.error);
    if (returnedError) {
      return writeText(res, 400, `LINE Login failed: ${returnedError}`);
    }

    const code = normalizeQueryValue(req.query && req.query.code);
    const state = normalizeQueryValue(req.query && req.query.state);
    if (!code || !state || !timingSafeEqualText(state, flowState.state)) {
      return writeText(res, 400, 'Invalid LINE Login callback state');
    }

    const config = getAppConfig(flowState.app);
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: flowState.codeVerifier,
      callbackUrl: config.callbackUrl,
      channelId: config.channelId,
      channelSecret: config.channelSecret,
    });

    const verified = await verifyIdToken({
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      channelId: config.channelId,
      nonce: flowState.nonce,
    });

    const nowIso = new Date().toISOString();
    const user = await upsertAppUserProfile({
      providerNamespace: config.providerNamespace,
      lineChannelId: config.channelId,
      lineUserId: verified.lineUserId,
      displayName: verified.displayName,
      pictureUrl: verified.pictureUrl,
      lastLoginAt: nowIso,
    });

    const memberships = await listMembershipsForUser(user.id);
    const access = resolveMembershipAccess(flowState.app, memberships);

    if (access.outcome === 'approved') {
      const sessionToken = createSessionToken();
      await createAuthSession({
        userId: user.id,
        app: flowState.app,
        sessionTokenHash: hashSessionToken(sessionToken),
        userAgent: req.headers['user-agent'] || null,
        ipHash: getRequestIpHash(req),
        expiresAt: new Date(Date.now() + getSessionMaxAgeSeconds() * 1000).toISOString(),
      });
      setSessionCookie(res, sessionToken);
      return redirect(res, flowState.returnTo || config.successPath);
    }

    if (access.outcome === 'pending') {
      await ensurePendingAccessRequest(user.id, flowState.app);
      return redirect(res, config.pendingPath);
    }

    return writeText(res, 403, 'Forbidden for requested app');
  } catch (error) {
    return sendError(res, error);
  }
};
