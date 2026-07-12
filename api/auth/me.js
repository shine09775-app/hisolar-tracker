const { getAuthenticatedSessionContext } = require('../_lib/auth-context');
const { normalizeApp } = require('../_lib/config');
const { clearSessionCookie } = require('../_lib/session');
const { methodNotAllowed, normalizeQueryValue, sendError, writeJson } = require('../_lib/http');
const { listApprovedMembersForOrganization } = require('../_lib/supabase-admin');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const app = normalizeApp(normalizeQueryValue(req.query && req.query.app)) || undefined;
    const context = await getAuthenticatedSessionContext(req, app);
    const availableApps = (context.memberships || [])
      .filter(item => item.status === 'approved')
      .map(item => ({
        organization: item.organization,
        role: item.role,
        status: item.status,
      }));
    const teamMembers = context.targetApp === 'hisolar'
      ? await listApprovedMembersForOrganization('hisolar')
      : [];

    return writeJson(res, 200, {
      authenticated: true,
      app: context.targetApp,
      session: {
        id: context.session.id,
        app: context.session.app,
        expiresAt: context.session.expires_at,
      },
      user: {
        id: context.user.id,
        displayName: context.user.display_name,
        pictureUrl: context.user.picture_url,
      },
      membership: {
        organization: context.membership.organization,
        role: context.membership.role,
        status: context.membership.status,
        approvedAt: context.membership.approved_at,
      },
      availableApps,
      teamMembers,
    });
  } catch (error) {
    if (error && error.statusCode === 401) clearSessionCookie(res);
    return sendError(res, error);
  }
};
