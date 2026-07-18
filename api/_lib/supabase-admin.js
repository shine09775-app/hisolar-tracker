const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { createHttpError } = require('./http');

let cachedAdminClient = null;

function getSupabaseAdminClient() {
  if (cachedAdminClient) return cachedAdminClient;
  const url = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    throw createHttpError(500, 'Supabase admin credentials are not configured');
  }
  cachedAdminClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedAdminClient;
}

function getRequestIpHash(req) {
  const forwardedFor = req.headers['x-forwarded-for'] || '';
  const firstIp = String(Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
    .split(',')
    .map(part => part.trim())
    .find(Boolean);
  if (!firstIp) return null;
  return crypto.createHash('sha256').update(firstIp).digest('hex');
}

async function upsertAppUserProfile({
  providerNamespace,
  lineChannelId,
  lineUserId,
  displayName,
  pictureUrl,
  lastLoginAt,
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_users')
    .upsert(
      {
        line_provider: 'line',
        provider_namespace: providerNamespace,
        line_channel_id: lineChannelId,
        line_user_id: lineUserId,
        display_name: displayName || 'LINE User',
        picture_url: pictureUrl || null,
        last_login_at: lastLoginAt,
      },
      {
        onConflict: 'provider_namespace,line_user_id',
      }
    )
    .select('*')
    .single();
  if (error) throw createHttpError(500, 'Failed to upsert app user', error.message);
  return data;
}

async function listMembershipsForUser(userId) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_memberships')
    .select('*')
    .eq('user_id', userId);
  if (error) throw createHttpError(500, 'Failed to load memberships', error.message);
  return data || [];
}

async function listApprovedMembersForOrganization(organization) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_memberships')
    .select(`
      organization,
      role,
      status,
      approved_at,
      user:app_users!app_memberships_user_id_fkey (
        id,
        display_name,
        picture_url
      )
    `)
    .eq('organization', organization)
    .eq('status', 'approved')
    .order('role', { ascending: true })
    .order('approved_at', { ascending: true, nullsFirst: false });
  if (error) throw createHttpError(500, 'Failed to load organization members', error.message);
  return (data || [])
    .map(row => ({
      organization: row.organization,
      role: row.role,
      status: row.status,
      approvedAt: row.approved_at,
      user: row.user || null,
    }))
    .filter(row => row.user && row.user.id && row.user.display_name);
}

async function getMembershipForUserApp(userId, app) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_memberships')
    .select('*')
    .eq('user_id', userId)
    .eq('organization', app)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw createHttpError(500, 'Failed to load membership', error.message);
  }
  return data || null;
}

async function ensureJdkAutoApprovedMembership(userId, approvedAt) {
  const existing = await getMembershipForUserApp(userId, 'jdk');
  if (existing && (existing.status === 'suspended' || existing.status === 'revoked')) {
    return existing;
  }
  if (existing && existing.status === 'approved') {
    return existing;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_memberships')
    .upsert(
      {
        user_id: userId,
        organization: 'jdk',
        role: 'commenter',
        status: 'approved',
        approved_by: null,
        approved_at: approvedAt,
      },
      {
        onConflict: 'user_id,organization',
      }
    )
    .select('*')
    .single();
  if (error) throw createHttpError(500, 'Failed to auto-approve JDK membership', error.message);

  const { error: requestError } = await supabase
    .from('access_requests')
    .update({
      status: 'approved',
      reviewed_by: null,
      reviewed_at: approvedAt,
    })
    .eq('user_id', userId)
    .eq('requested_organization', 'jdk')
    .eq('status', 'pending');
  if (requestError) {
    throw createHttpError(500, 'Failed to close JDK access request', requestError.message);
  }

  return data;
}

async function getAppUserById(userId) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw createHttpError(500, 'Failed to load app user', error.message);
  }
  return data || null;
}

async function ensurePendingAccessRequest(userId, app) {
  const supabase = getSupabaseAdminClient();
  const { data: existing, error: loadError } = await supabase
    .from('access_requests')
    .select('id')
    .eq('user_id', userId)
    .eq('requested_organization', app)
    .eq('status', 'pending')
    .maybeSingle();
  if (loadError && loadError.code !== 'PGRST116') {
    throw createHttpError(500, 'Failed to read access request', loadError.message);
  }
  const nowIso = new Date().toISOString();
  if (existing) {
    const { error: updateError } = await supabase
      .from('access_requests')
      .update({ requested_at: nowIso })
      .eq('id', existing.id);
    if (updateError) throw createHttpError(500, 'Failed to update access request', updateError.message);
    return existing.id;
  }
  const { data: inserted, error: insertError } = await supabase
    .from('access_requests')
    .insert({
      user_id: userId,
      requested_organization: app,
      status: 'pending',
      requested_at: nowIso,
    })
    .select('id')
    .single();
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: concurrentExisting, error: concurrentLoadError } = await supabase
        .from('access_requests')
        .select('id')
        .eq('user_id', userId)
        .eq('requested_organization', app)
        .eq('status', 'pending')
        .maybeSingle();
      if (concurrentLoadError && concurrentLoadError.code !== 'PGRST116') {
        throw createHttpError(500, 'Failed to read access request after conflict', concurrentLoadError.message);
      }
      if (concurrentExisting) return concurrentExisting.id;
    }
    throw createHttpError(500, 'Failed to create access request', insertError.message);
  }
  return inserted.id;
}

async function createAuthSession({ userId, app, sessionTokenHash, userAgent, ipHash, expiresAt }) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('auth_sessions')
    .insert({
      user_id: userId,
      app,
      session_token_hash: sessionTokenHash,
      user_agent: userAgent || null,
      ip_hash: ipHash || null,
      expires_at: expiresAt,
    })
    .select('*')
    .single();
  if (error) throw createHttpError(500, 'Failed to create auth session', error.message);
  return data;
}

async function getAuthSessionByHash(sessionTokenHash) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('auth_sessions')
    .select('*')
    .eq('session_token_hash', sessionTokenHash)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw createHttpError(500, 'Failed to load auth session', error.message);
  }
  return data || null;
}

async function touchAuthSession(sessionId) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from('auth_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw createHttpError(500, 'Failed to update auth session', error.message);
}

async function revokeAuthSessionByHash(sessionTokenHash) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('session_token_hash', sessionTokenHash)
    .is('revoked_at', null);
  if (error) throw createHttpError(500, 'Failed to revoke auth session', error.message);
}

module.exports = {
  createAuthSession,
  ensureJdkAutoApprovedMembership,
  ensurePendingAccessRequest,
  getAppUserById,
  getAuthSessionByHash,
  getMembershipForUserApp,
  getRequestIpHash,
  getSupabaseAdminClient,
  listApprovedMembersForOrganization,
  listMembershipsForUser,
  revokeAuthSessionByHash,
  touchAuthSession,
  upsertAppUserProfile,
};
