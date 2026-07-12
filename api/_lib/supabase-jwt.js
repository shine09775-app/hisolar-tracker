const { webcrypto } = require('crypto');
const { toBase64Url } = require('./base64url');
const { createHttpError } = require('./http');

let cachedSigningKeyPromise = null;

function parsePrivateKeySource() {
  const raw = process.env.SUPABASE_JWT_PRIVATE_KEY || '';
  if (!raw) throw createHttpError(500, 'SUPABASE_JWT_PRIVATE_KEY is not configured');
  const normalized = raw.trim();
  if (normalized.startsWith('{')) {
    return { format: 'jwk', value: JSON.parse(normalized) };
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
  const issuer = process.env.SUPABASE_JWT_ISSUER || '';
  const audience = process.env.SUPABASE_JWT_AUDIENCE || 'authenticated';
  if (!issuer) throw createHttpError(500, 'SUPABASE_JWT_ISSUER is not configured');

  const header = {
    alg: 'ES256',
    typ: 'JWT',
  };
  const kid = process.env.SUPABASE_JWT_KID || '';
  if (kid) header.kid = kid;

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
