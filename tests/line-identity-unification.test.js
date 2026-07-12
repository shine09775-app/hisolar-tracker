const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

test('same LINE user across hisolar and jdk resolves to one app_user and can hold both memberships', async t => {
  const supabaseModulePath = require.resolve('@supabase/supabase-js');
  const adminModulePath = require.resolve('../api/_lib/supabase-admin');
  const authRulesModulePath = require.resolve('../api/_lib/auth-rules');

  const originalSupabaseModule = require.cache[supabaseModulePath];
  const originalAdminModule = require.cache[adminModulePath];

  delete require.cache[adminModulePath];

  const usersByIdentity = new Map();
  const membershipRows = [];
  const upsertCalls = [];

  require.cache[supabaseModulePath] = {
    id: supabaseModulePath,
    filename: supabaseModulePath,
    loaded: true,
    exports: {
      createClient() {
        return {
          from(table) {
            if (table === 'app_users') {
              return {
                upsert(payload, options) {
                  upsertCalls.push({ payload, options });
                  const key = `${payload.provider_namespace}|${payload.line_user_id}`;
                  let row = usersByIdentity.get(key);
                  if (!row) {
                    row = { id: `user-${usersByIdentity.size + 1}`, ...payload };
                    usersByIdentity.set(key, row);
                  } else {
                    row = { ...row, ...payload };
                    usersByIdentity.set(key, row);
                  }
                  return {
                    select() {
                      return {
                        async single() {
                          return { data: { ...row }, error: null };
                        },
                      };
                    },
                  };
                },
              };
            }

            if (table === 'app_memberships') {
              return {
                select() {
                  return {
                    async eq(column, value) {
                      assert.equal(column, 'user_id');
                      return {
                        data: membershipRows.filter(row => row.user_id === value),
                        error: null,
                      };
                    },
                  };
                },
              };
            }

            throw new Error(`Unexpected table ${table}`);
          },
        };
      },
    },
  };

  t.after(() => {
    delete require.cache[adminModulePath];
    if (originalAdminModule) {
      require.cache[adminModulePath] = originalAdminModule;
    }
    if (originalSupabaseModule) {
      require.cache[supabaseModulePath] = originalSupabaseModule;
    } else {
      delete require.cache[supabaseModulePath];
    }
  });

  const { upsertAppUserProfile, listMembershipsForUser } = require('../api/_lib/supabase-admin');
  const { resolveMembershipAccess } = require(authRulesModulePath);

  const userFromHiSolar = await upsertAppUserProfile({
    providerNamespace: 'hisolar-tracker-line',
    lineChannelId: 'shared-channel',
    lineUserId: 'line-user-123',
    displayName: 'Shared Line User',
    pictureUrl: 'https://example.com/pic-1.jpg',
    lastLoginAt: '2026-07-12T00:00:00.000Z',
  });

  membershipRows.push(
    { user_id: userFromHiSolar.id, organization: 'hisolar', role: 'member', status: 'approved' },
    { user_id: userFromHiSolar.id, organization: 'jdk', role: 'commenter', status: 'approved' }
  );

  const userFromJdk = await upsertAppUserProfile({
    providerNamespace: 'hisolar-tracker-line',
    lineChannelId: 'shared-channel',
    lineUserId: 'line-user-123',
    displayName: 'Shared Line User Updated',
    pictureUrl: 'https://example.com/pic-2.jpg',
    lastLoginAt: '2026-07-12T01:00:00.000Z',
  });

  assert.equal(upsertCalls.length, 2);
  assert.equal(upsertCalls[0].options.onConflict, 'provider_namespace,line_user_id');
  assert.equal(upsertCalls[1].options.onConflict, 'provider_namespace,line_user_id');
  assert.equal(userFromHiSolar.id, userFromJdk.id);

  const memberships = await listMembershipsForUser(userFromJdk.id);
  assert.equal(memberships.length, 2);
  assert.equal(resolveMembershipAccess('hisolar', memberships).outcome, 'approved');
  assert.equal(resolveMembershipAccess('jdk', memberships).outcome, 'approved');
});
