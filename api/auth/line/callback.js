const {
  HANDOFF_CLAIM_SECONDS,
  clearFlowCookie,
  hashLoginState,
  readFlowStateFromRequest,
} = require('../../_lib/auth-flow');
const { getLoginPagePath, writeAuthPage } = require('../../_lib/auth-pages');
const { getAppConfig, getSessionMaxAgeSeconds } = require('../../_lib/config');
const { resolveJdkAutoApproval, resolveMembershipAccess } = require('../../_lib/auth-rules');
const { methodNotAllowed, normalizeQueryValue, redirect, sendError } = require('../../_lib/http');
const { exchangeCodeForTokens, verifyIdToken } = require('../../_lib/line-login');
const {
  claimLoginFlow,
  completeLoginFlow,
  createAuthSession,
  ensureJdkAutoApprovedMembership,
  ensurePendingAccessRequest,
  getRequestIpHash,
  listMembershipsForUser,
  upsertAppUserProfile,
} = require('../../_lib/supabase-admin');
const { createSessionToken, hashSessionToken, setSessionCookie } = require('../../_lib/session');
const { timingSafeEqualText } = require('../../_lib/security');

function writeRetryPage(res, app, title, text) {
  return writeAuthPage(res, 400, {
    title,
    text,
    actionLabel: 'เข้าสู่ระบบอีกครั้ง',
    actionHref: getLoginPagePath(app),
  });
}

// Picks the login attempt this callback belongs to. The flow cookie wins when
// LINE came back to the same browser; otherwise the stored row is used, which
// is what happens when the LINE app reopens the callback in its own browser.
function resolveFlowState(cookieFlow, storedFlow, state) {
  if (!state) return null;
  if (cookieFlow && timingSafeEqualText(state, cookieFlow.state)) {
    return cookieFlow;
  }
  if (storedFlow) {
    return {
      app: storedFlow.app,
      returnTo: storedFlow.return_to,
      nonce: storedFlow.nonce,
      codeVerifier: storedFlow.code_verifier,
    };
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const cookieFlow = readFlowStateFromRequest(req);
    clearFlowCookie(res);

    const code = normalizeQueryValue(req.query && req.query.code);
    const state = normalizeQueryValue(req.query && req.query.state);
    const returnedError = normalizeQueryValue(req.query && req.query.error);
    const stateHash = state ? hashLoginState(state) : '';
    // Claiming marks the stored attempt used, so the same callback URL cannot
    // be replayed in a second browser.
    const storedFlow = stateHash ? await claimLoginFlow(stateHash) : null;
    const flowState = resolveFlowState(cookieFlow, storedFlow, state);
    const app = (flowState && flowState.app) || (cookieFlow && cookieFlow.app);

    if (returnedError) {
      return writeRetryPage(res, app, 'ยังไม่ได้เข้าสู่ระบบ', `LINE Login ไม่สำเร็จ (${returnedError}) กรุณาลองใหม่อีกครั้ง`);
    }

    if (!flowState || !code) {
      return writeRetryPage(
        res,
        app,
        'ลิงก์เข้าสู่ระบบหมดอายุ',
        'การเข้าสู่ระบบครั้งนี้หมดเวลาหรือถูกใช้ไปแล้ว กดปุ่มด้านล่างเพื่อเข้าสู่ระบบใหม่'
      );
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

    let memberships = await listMembershipsForUser(user.id);
    const jdkAutoApproval = resolveJdkAutoApproval(flowState.app, memberships);
    if (jdkAutoApproval.shouldAutoApprove) {
      await ensureJdkAutoApprovedMembership(user.id, nowIso);
      memberships = await listMembershipsForUser(user.id);
    }

    const access = resolveMembershipAccess(flowState.app, memberships);
    // A home-screen app started this login and is polling for the result.
    const handoff = Boolean(storedFlow && storedFlow.handoff_hash);
    const handoffExpiresAt = new Date(Date.now() + HANDOFF_CLAIM_SECONDS * 1000).toISOString();

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
      const successPath = flowState.returnTo || config.successPath;

      if (handoff) {
        await completeLoginFlow(stateHash, { userId: user.id, outcome: 'approved', expiresAt: handoffExpiresAt });
        return writeAuthPage(res, 200, {
          title: 'เข้าสู่ระบบสำเร็จ',
          text: 'กลับไปที่แอป Hi Solar บนหน้าจอโฮมได้เลย ระบบจะเข้าให้อัตโนมัติ',
          actionLabel: 'ใช้งานต่อในหน้านี้',
          actionHref: successPath,
          note: 'กลับไปที่แอปแล้วปิดหน้านี้ได้เลย',
        });
      }
      return redirect(res, successPath);
    }

    if (access.outcome === 'pending') {
      await ensurePendingAccessRequest(user.id, flowState.app);
      if (handoff) {
        await completeLoginFlow(stateHash, { userId: user.id, outcome: 'pending', expiresAt: handoffExpiresAt });
      }
      return redirect(res, config.pendingPath);
    }

    return writeAuthPage(res, 403, {
      title: 'ไม่มีสิทธิ์เข้าใช้งาน',
      text: 'บัญชี LINE นี้ยังไม่มีสิทธิ์เปิดระบบนี้ ถ้าควรมีสิทธิ์ ให้แจ้งผู้ดูแลระบบ Hi Solar',
      actionLabel: 'กลับหน้าเข้าสู่ระบบ',
      actionHref: getLoginPagePath(flowState.app),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports.resolveFlowState = resolveFlowState;
