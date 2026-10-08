const {
  createFlowState,
  hashLoginState,
  normalizeHandoffHash,
  setFlowCookie,
} = require('../../_lib/auth-flow');
const { getAppConfig, normalizeApp, resolveReturnTo } = require('../../_lib/config');
const { methodNotAllowed, normalizeQueryValue, redirect, sendError } = require('../../_lib/http');
const { buildAuthorizeUrl } = require('../../_lib/line-login');
const { saveLoginFlow } = require('../../_lib/supabase-admin');

function getRequestHost(req) {
  return String(
    (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function getCanonicalStartUrl(req, config, app, returnTo, handoffHash) {
  const callback = new URL(config.callbackUrl);
  const requestHost = getRequestHost(req);
  if (!requestHost || requestHost === callback.host.toLowerCase()) return null;

  const canonical = new URL('/api/auth/line/start', callback.origin);
  canonical.searchParams.set('app', app);
  if (returnTo) canonical.searchParams.set('return_to', returnTo);
  if (handoffHash) canonical.searchParams.set('handoff', handoffHash);
  return canonical.toString();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const app = normalizeApp(normalizeQueryValue(req.query && req.query.app));
    const returnTo = resolveReturnTo(app, normalizeQueryValue(req.query && req.query.return_to));
    const handoffHash = normalizeHandoffHash(normalizeQueryValue(req.query && req.query.handoff));
    const config = getAppConfig(app);
    const canonicalStartUrl = getCanonicalStartUrl(req, config, app, returnTo, handoffHash);
    if (canonicalStartUrl) {
      return redirect(res, canonicalStartUrl);
    }

    const flowState = createFlowState({ app, returnTo });

    // The cookie covers the common case (same browser end to end); the row lets
    // the callback finish when LINE returns to a different browser.
    await saveLoginFlow({
      stateHash: hashLoginState(flowState.state),
      app,
      returnTo,
      nonce: flowState.nonce,
      codeVerifier: flowState.codeVerifier,
      handoffHash,
      expiresAt: new Date(flowState.expiresAt).toISOString(),
    });
    setFlowCookie(res, flowState.cookieValue, flowState.expiresAt);

    return redirect(
      res,
      buildAuthorizeUrl({
        channelId: config.channelId,
        callbackUrl: config.callbackUrl,
        state: flowState.state,
        nonce: flowState.nonce,
        codeChallenge: flowState.codeChallenge,
      })
    );
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports.getCanonicalStartUrl = getCanonicalStartUrl;
