const test = require('node:test');
const assert = require('node:assert/strict');

// A Vercel dashboard env var pasted from a masked/obscured display (or any
// other corruption) can put a codepoint above 255 into SUPABASE_SERVICE_ROLE_KEY
// or SUPABASE_URL. Both go into HTTP header values on every admin request, and
// fetch's ByteString conversion then throws deep inside supabase-js with a
// generic message that names no variable and no request. This guard is meant
// to fail at the same call with a message an operator can act on immediately.

// Other test files run in this same process (package.json sets
// --test-isolation=none) and set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at
// module load time with no restore. The env swap and the call under test must
// happen inside the same window, or the values under test never take effect.
function withAdminEnv(env, run) {
  const originalEnv = { ...process.env };
  Object.assign(process.env, env);
  const adminModulePath = require.resolve('../api/_lib/supabase-admin');
  delete require.cache[adminModulePath];
  try {
    const admin = require('../api/_lib/supabase-admin');
    return run(admin);
  } finally {
    process.env = originalEnv;
    delete require.cache[adminModulePath];
  }
}

test('a corrupted service role key fails fast with the variable name and character position', () => {
  withAdminEnv(
    {
      SUPABASE_URL: 'https://example.supabase.co',
      // A bullet (U+2022) at position 7, matching the shape of the real incident
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGc•iOiJIUzI1NiJ9.test',
    },
    (admin) => {
      assert.throws(
        () => admin.getSupabaseAdminClient(),
        (error) => {
          assert.equal(error.statusCode, 500);
          assert.match(error.message, /SUPABASE_SERVICE_ROLE_KEY/);
          assert.match(error.message, /U\+2022/);
          assert.match(error.message, /position 7/);
          assert.match(error.details, /Re-enter SUPABASE_SERVICE_ROLE_KEY/);
          return true;
        }
      );
    }
  );
});

test('a corrupted Supabase URL is caught by the same guard', () => {
  withAdminEnv(
    {
      SUPABASE_URL: 'https://example•.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'clean-service-role-key',
    },
    (admin) => {
      assert.throws(
        () => admin.getSupabaseAdminClient(),
        (error) => {
          assert.match(error.message, /SUPABASE_URL/);
          assert.match(error.message, /U\+2022/);
          return true;
        }
      );
    }
  );
});

test('clean credentials pass the guard without throwing', () => {
  withAdminEnv(
    {
      SUPABASE_URL: 'https://hlswbazcojsnfibirkzl.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig',
    },
    (admin) => {
      assert.doesNotThrow(() => admin.getSupabaseAdminClient());
    }
  );
});

test('missing credentials still report as unconfigured, not as a ByteString problem', () => {
  withAdminEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, (admin) => {
    assert.throws(
      () => admin.getSupabaseAdminClient(),
      (error) => {
        assert.match(error.message, /not configured/);
        return true;
      }
    );
  });
});
