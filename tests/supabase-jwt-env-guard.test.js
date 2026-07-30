const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

// The production cutover lost an afternoon to two dashboard env vars that
// arrived with a stray bullet character in them. The service role key failed
// loudly (a ByteString TypeError from fetch); SUPABASE_JWT_KID failed silently,
// because the signer treated kid as optional and simply omitted it. Supabase
// publishes several ES256 keys, so a token with no kid matches none of them and
// comes back as "No suitable key or wrong key type" -- an error that names
// nothing on our side. These tests pin the guard that turns each of those into
// a message naming the variable.

// Throwaway P-256 key generated for this test only — never a project key.
const JWK = {
  kty: 'EC',
  kid: '00000000-0000-4000-8000-000000000000',
  use: 'sig',
  key_ops: ['sign', 'verify'],
  alg: 'ES256',
  ext: true,
  d: 'G5quhPfQRel05Y33Vwjfpr2UuezsfrDneAvyRfDidmI',
  crv: 'P-256',
  x: 'YeEct82ALD0UAoYUpJrZmIPans-D-b_U6YxNQBU0Ho8',
  y: 'kTOvEMD8jP7plLfgK_NAAvKsth4d2FOFj2fG_q15joU',
};

const VALID_ENV = {
  SUPABASE_JWT_PRIVATE_KEY: JSON.stringify(JWK),
  SUPABASE_JWT_KID: JWK.kid,
  SUPABASE_JWT_ISSUER: 'https://example-project.supabase.co/auth/v1',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
};

const FIXTURE = {
  session: { id: 'session-1' },
  user: { id: 'user-1', display_name: 'Shine', picture_url: null },
  membership: { organization: 'hisolar', role: 'admin', status: 'approved' },
};

// Other test files in this process set these vars at load time, so the swap and
// the call have to happen together.
async function withJwtEnv(env, run) {
  const originalEnv = { ...process.env };
  Object.assign(process.env, VALID_ENV, env);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
  }
  const modulePath = require.resolve('../api/_lib/supabase-jwt');
  delete require.cache[modulePath];
  try {
    return await run(require('../api/_lib/supabase-jwt'));
  } finally {
    process.env = originalEnv;
    delete require.cache[modulePath];
  }
}

const decodeSegment = (segment) =>
  JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

test('a missing kid is refused instead of producing a token Supabase cannot match', async () => {
  await withJwtEnv({ SUPABASE_JWT_KID: undefined }, async (jwt) => {
    await assert.rejects(
      () => jwt.signSupabaseAccessToken(FIXTURE),
      (error) => {
        assert.equal(error.statusCode, 500);
        assert.match(error.message, /SUPABASE_JWT_KID is not configured/);
        assert.match(error.details, /jwks\.json/);
        return true;
      }
    );
  });
});

test('a kid corrupted by a stray character names the variable and position', async () => {
  await withJwtEnv({ SUPABASE_JWT_KID: '00000000•0000-4000-8000-000000000000' }, async (jwt) => {
    await assert.rejects(
      () => jwt.signSupabaseAccessToken(FIXTURE),
      (error) => {
        assert.match(error.message, /SUPABASE_JWT_KID/);
        assert.match(error.message, /U\+2022/);
        assert.match(error.message, /position 8/);
        return true;
      }
    );
  });
});

test('a kid that is not a JWKS key id is reported as malformed', async () => {
  await withJwtEnv({ SUPABASE_JWT_KID: 'the service role key by mistake' }, async (jwt) => {
    await assert.rejects(
      () => jwt.signSupabaseAccessToken(FIXTURE),
      (error) => {
        assert.match(error.message, /SUPABASE_JWT_KID is malformed/);
        return true;
      }
    );
  });
});

test('a private key that is not valid JSON is reported as such, not as a crypto error', async () => {
  await withJwtEnv({ SUPABASE_JWT_PRIVATE_KEY: '{"kty":"EC","d":"trunc' }, async (jwt) => {
    await assert.rejects(
      () => jwt.signSupabaseAccessToken(FIXTURE),
      (error) => {
        assert.match(error.message, /SUPABASE_JWT_PRIVATE_KEY is not valid JSON/);
        return true;
      }
    );
  });
});

test('an issuer missing the /auth/v1 path is rejected before signing', async () => {
  await withJwtEnv({ SUPABASE_JWT_ISSUER: 'https://example-project.supabase.co' }, async (jwt) => {
    await assert.rejects(
      () => jwt.signSupabaseAccessToken(FIXTURE),
      (error) => {
        assert.match(error.message, /SUPABASE_JWT_ISSUER is malformed/);
        assert.match(error.details, /auth\/v1/);
        return true;
      }
    );
  });
});

test('surrounding whitespace on a pasted value is tolerated', async () => {
  await withJwtEnv(
    {
      SUPABASE_JWT_KID: `  ${JWK.kid}\n`,
      SUPABASE_JWT_ISSUER: ` ${VALID_ENV.SUPABASE_JWT_ISSUER} `,
    },
    async (jwt) => {
      const { token } = await jwt.signSupabaseAccessToken(FIXTURE);
      assert.equal(decodeSegment(token.split('.')[0]).kid, JWK.kid);
    }
  );
});

test('a signed token carries the kid Supabase needs and verifies against the public key', async () => {
  await withJwtEnv({}, async (jwt) => {
    const { token, expiresAt } = await jwt.signSupabaseAccessToken(FIXTURE);
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');

    const header = decodeSegment(encodedHeader);
    assert.equal(header.alg, 'ES256');
    assert.equal(header.typ, 'JWT');
    assert.equal(header.kid, JWK.kid, 'kid must be present for JWKS key selection');

    const payload = decodeSegment(encodedPayload);
    assert.equal(payload.iss, VALID_ENV.SUPABASE_JWT_ISSUER);
    assert.equal(payload.aud, 'authenticated');
    assert.equal(payload.role, 'authenticated');
    assert.equal(payload.sub, FIXTURE.user.id);
    assert.equal(payload.organization, 'hisolar');
    assert.equal(payload.membership_role, 'admin');
    assert.equal(new Date(expiresAt).getTime(), payload.exp * 1000);

    // Verify with the public half only, the way Supabase does from its JWKS
    const { d, key_ops, ...publicJwk } = JWK;
    const publicKey = await webcrypto.subtle.importKey(
      'jwk',
      { ...publicJwk, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const signature = Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const verified = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );
    assert.equal(verified, true, 'signature must verify against the JWKS public key');
  });
});
