const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

async function withMockedSupabaseClient(client, fn) {
  const supabaseModulePath = require.resolve('@supabase/supabase-js');
  const adminModulePath = require.resolve('../api/_lib/supabase-admin');
  const originalSupabaseModule = require.cache[supabaseModulePath];
  const originalAdminModule = require.cache[adminModulePath];

  delete require.cache[adminModulePath];
  require.cache[supabaseModulePath] = {
    id: supabaseModulePath,
    filename: supabaseModulePath,
    loaded: true,
    exports: {
      createClient() {
        return client;
      },
    },
  };

  try {
    const admin = require('../api/_lib/supabase-admin');
    await fn(admin);
  } finally {
    delete require.cache[adminModulePath];
    if (originalAdminModule) {
      require.cache[adminModulePath] = originalAdminModule;
    }
    if (originalSupabaseModule) {
      require.cache[supabaseModulePath] = originalSupabaseModule;
    } else {
      delete require.cache[supabaseModulePath];
    }
  }
}

function createJdkAutoApprovalClient(existingMembership = null) {
  const calls = {
    membershipFilters: [],
    membershipUpserts: [],
    accessRequestUpdates: [],
    accessRequestFilters: [],
  };

  const client = {
    calls,
    from(table) {
      if (table === 'app_memberships') {
        return {
          select() {
            const chain = {
              eq(column, value) {
                calls.membershipFilters.push({ column, value });
                return chain;
              },
              async maybeSingle() {
                return { data: existingMembership, error: null };
              },
            };
            return chain;
          },
          upsert(payload, options) {
            calls.membershipUpserts.push({ payload, options });
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: 'membership-1', ...payload }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'access_requests') {
        return {
          update(payload) {
            calls.accessRequestUpdates.push(payload);
            const chain = {
              error: null,
              eq(column, value) {
                calls.accessRequestFilters.push({ column, value });
                return chain;
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };

  return client;
}

test('ensureJdkAutoApprovedMembership creates approved JDK commenter and closes pending request', async () => {
  const client = createJdkAutoApprovalClient();

  await withMockedSupabaseClient(client, async ({ ensureJdkAutoApprovedMembership }) => {
    const row = await ensureJdkAutoApprovedMembership('user-1', '2026-07-18T00:00:00.000Z');

    assert.equal(row.organization, 'jdk');
    assert.equal(row.role, 'commenter');
    assert.equal(row.status, 'approved');
  });

  assert.deepEqual(client.calls.membershipUpserts, [
    {
      payload: {
        user_id: 'user-1',
        organization: 'jdk',
        role: 'commenter',
        status: 'approved',
        approved_by: null,
        approved_at: '2026-07-18T00:00:00.000Z',
      },
      options: { onConflict: 'user_id,organization' },
    },
  ]);
  assert.deepEqual(client.calls.accessRequestUpdates, [
    {
      status: 'approved',
      reviewed_by: null,
      reviewed_at: '2026-07-18T00:00:00.000Z',
    },
  ]);
  assert.ok(
    client.calls.accessRequestFilters.some(
      filter => filter.column === 'requested_organization' && filter.value === 'jdk'
    )
  );
  assert.ok(
    client.calls.accessRequestFilters.some(filter => filter.column === 'status' && filter.value === 'pending')
  );
});

test('ensureJdkAutoApprovedMembership does not revive suspended or revoked JDK memberships', async () => {
  for (const status of ['suspended', 'revoked']) {
    const client = createJdkAutoApprovalClient({
      id: `membership-${status}`,
      user_id: 'user-1',
      organization: 'jdk',
      role: 'commenter',
      status,
    });

    await withMockedSupabaseClient(client, async ({ ensureJdkAutoApprovedMembership }) => {
      const row = await ensureJdkAutoApprovedMembership('user-1', '2026-07-18T00:00:00.000Z');
      assert.equal(row.status, status);
    });

    assert.deepEqual(client.calls.membershipUpserts, []);
    assert.deepEqual(client.calls.accessRequestUpdates, []);
  }
});
