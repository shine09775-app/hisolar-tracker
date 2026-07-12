const crypto = require('crypto');
const { toBase64Url } = require('./base64url');

function randomBase64Url(size = 32) {
  return toBase64Url(crypto.randomBytes(size));
}

function sha256Base64Url(input) {
  return toBase64Url(crypto.createHash('sha256').update(String(input)).digest());
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signValue(payload, secret) {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest()
  );
  return `${encodedPayload}.${signature}`;
}

function verifySignedValue(signedValue, secret) {
  if (!signedValue) return null;
  const parts = String(signedValue).split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  const expected = toBase64Url(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest()
  );
  if (!timingSafeEqualText(encodedSignature, expected)) return null;
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  return payload;
}

function createPkcePair() {
  const codeVerifier = randomBase64Url(48);
  return {
    codeVerifier,
    codeChallenge: sha256Base64Url(codeVerifier),
  };
}

module.exports = {
  createPkcePair,
  randomBase64Url,
  sha256Base64Url,
  sha256Hex,
  signValue,
  timingSafeEqualText,
  verifySignedValue,
};
