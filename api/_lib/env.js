const { createHttpError } = require('./http');

// Credentials pasted into a hosting dashboard arrive corrupted often enough to
// be worth guarding: a masked/obscured display copied by mistake, or an
// autofill extension writing into the field, leaves characters above U+00FF in
// the value. Those values end up in HTTP header values (ByteString-only) or in
// a JWT header, where the failure surfaces far from the cause -- as a generic
// TypeError from fetch, or as "No suitable key" from the token consumer.
//
// Reading env through here turns all of that into one message naming the
// variable, the offending codepoint and its position.
function readCleanEnv(name, { required = true, pattern = null, hint = '' } = {}) {
  const raw = process.env[name];
  const value = String(raw == null ? '' : raw).trim();

  if (!value) {
    if (!required) return '';
    throw createHttpError(500, `${name} is not configured`, hint || undefined);
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) {
      throw createHttpError(
        500,
        `${name} contains an invalid character (U+${code.toString(16).toUpperCase().padStart(4, '0')} at position ${i}) and cannot be used as an HTTP header value`,
        `Re-enter ${name} in Vercel — this usually happens when a masked/obscured value gets pasted instead of the real one.`
      );
    }
  }

  if (pattern && !pattern.test(value)) {
    throw createHttpError(
      500,
      `${name} is malformed`,
      hint || `Re-enter ${name} in Vercel; the stored value does not match the expected format.`
    );
  }

  return value;
}

module.exports = { readCleanEnv };
