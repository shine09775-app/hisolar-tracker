const { createFlowState, setFlowCookie } = require('../../_lib/auth-flow');
const { getAppConfig, normalizeApp, resolveReturnTo } = require('../../_lib/config');
const { methodNotAllowed, normalizeQueryValue, redirect, sendError } = require('../../_lib/http');
const { buildAuthorizeUrl } = require('../../_lib/line-login');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const app = normalizeApp(normalizeQueryValue(req.query && req.query.app));
    const returnTo = resolveReturnTo(app, normalizeQueryValue(req.query && req.query.return_to));
    const config = getAppConfig(app);
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
