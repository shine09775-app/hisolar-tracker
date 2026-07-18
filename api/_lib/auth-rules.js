function findMembership(memberships, organization) {
  return (memberships || []).find(item => item.organization === organization) || null;
}

function resolveJdkAutoApproval(app, memberships) {
  if (app !== 'jdk') {
    return { shouldAutoApprove: false, membership: null };
  }
  const requested = findMembership(memberships, 'jdk');
  if (!requested || requested.status === 'pending') {
    return { shouldAutoApprove: true, membership: requested };
  }
  return { shouldAutoApprove: false, membership: requested };
}

function resolveMembershipAccess(app, memberships) {
  const requested = findMembership(memberships, app);
  if (requested && requested.status === 'approved') {
    return { outcome: 'approved', membership: requested };
  }
  if (requested && requested.status === 'pending') {
    return { outcome: 'pending', membership: requested };
  }
  if (requested && (requested.status === 'suspended' || requested.status === 'revoked')) {
    return { outcome: 'forbidden', membership: requested };
  }
  const approvedOtherApp = (memberships || []).find(
    item => item.organization !== app && item.status === 'approved'
  );
  if (approvedOtherApp) {
    return { outcome: 'wrong_app', membership: approvedOtherApp };
  }
  return { outcome: 'pending', membership: null };
}

function isSessionActive(session, nowMs = Date.now()) {
  if (!session || session.revoked_at) return false;
  const expiresAt = new Date(session.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

module.exports = {
  isSessionActive,
  resolveJdkAutoApproval,
  resolveMembershipAccess,
};
