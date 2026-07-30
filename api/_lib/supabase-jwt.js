const { webcrypto } = require('crypto');
const { toBase64Url } = require('./base64url');
const { readCleanEnv } = require('./env');
const { createHttpError } = require('./http');

// Supabase selects the verifying key by `kid` -- the project JWKS holds several
// ES256 keys, so a token without one, or with a corrupted one, is rejected with
// "No suitable key or wrong key type" from Supabase rather than anything
// pointing back at this config. Keys are UUIDs, so anything else is a bad paste.
const JWKS_KID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

let cachedSigningKeyPromise = null;

function parsePrivateKeySource() {
  const normalized = readCleanEnv('SUPABASE_JWT_PRIVATE_KEY');
  if (normalized.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch (_error) {
      throw createHttpError(
        500,
        'SUPABASE_JWT_PRIVATE_KEY is not valid JSON',
        'Re-enter SUPABASE_JWT_PRIVATE_KEY in Vercel; the stored JWK appears truncated or altered.'
      );
    }
    return { format: 'jwk', value: parsed };
  }
  const pem = normalized.replace(/\\n/g, '\n');
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  return { format: 'pkcs8', value: Buffer.from(base64, 'base64') };
}

async function getSigningKey() {
  if (!cachedSigningKeyPromise) {
    cachedSigningKeyPromise = (async () => {
      const source = parsePrivateKeySource();
      if (source.format === 'jwk') {
        return webcrypto.subtle.importKey(
          'jwk',
          source.value,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['sign']
        );
      }
      return webcrypto.subtle.importKey(
        'pkcs8',
        source.value,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
      );
    })();
  }
  return cachedSigningKeyPromise;
}

async function signSupabaseAccessToken({ session, user, membership, lifetimeSeconds = 300 }) {
  const issuer = readCleanEnv('SUPABASE_JWT_ISSUER', {
    pattern: /^https:\/\/[^\s]+\/auth\/v1$/,
    hint: 'Expected https://<project-ref>.supabase.co/auth/v1',
  });
  const audience = readCleanEnv('SUPABASE_JWT_AUDIENCE', { required: false }) || 'authenticated';
  // Required, not optional: without a kid Supabase cannot pick a key out of the
  // project JWKS and rejects every token, with no hint that the kid is missing.
  const kid = readCleanEnv('SUPABASE_JWT_KID', {
    pattern: JWKS_KID_PATTERN,
    hint: 'Must match a kid published at https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json',
  });

  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid,
  };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer,
    aud: audience,
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
    nbf: nowSeconds,
    sub: user.id,
    role: 'authenticated',
    aal: 'aal1',
    session_id: session.id,
    app_user_id: user.id,
    organization: membership.organization,
    membership_role: membership.role,
    membership_status: membership.status,
    display_name: user.display_name,
    picture_url: user.picture_url,
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = await getSigningKey();
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return {
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    token: `${signingInput}.${toBase64Url(Buffer.from(signature))}`,
  };
}

module.exports = {
  signSupabaseAccessToken,
};
