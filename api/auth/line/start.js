const { createFlowState, setFlowCookie } = require('../../_lib/auth-flow');
const { getAppConfig, normalizeApp, resolveReturnTo } = require('../../_lib/config');
const { methodNotAllowed, normalizeQueryValue, redirect, sendError } = require('../../_lib/http');
const { buildAuthorizeUrl } = require('../../_lib/line-login');

function getRequestHost(req) {
  return String(
    (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function getCanonicalStartUrl(req, config, app, returnTo) {
  const callback = new URL(config.callbackUrl);
  const requestHost = getRequestHost(req);
  if (!requestHost || requestHost === callback.host.toLowerCase()) return null;

  const canonical = new URL('/api/auth/line/start', callback.origin);
  canonical.searchParams.set('app', app);
  if (returnTo) canonical.searchParams.set('return_to', returnTo);
  return canonical.toString();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const app = normalizeApp(normalizeQueryValue(req.query && req.query.app));
    const returnTo = resolveReturnTo(app, normalizeQueryValue(req.query && req.query.return_to));
    const config = getAppConfig(app);
    const canonicalStartUrl = getCanonicalStartUrl(req, config, app, returnTo);
    if (canonicalStartUrl) {
      return redirect(res, canonicalStartUrl);
    }

    const flowState = createFlowState({ app, returnTo });

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
