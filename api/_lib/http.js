function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeQueryValue(value) {
  if (Array.isArray(value)) return value[0];
  if (value === undefined || value === null) return '';
  return String(value);
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(payload));
}

function writeText(res, statusCode, text, extraHeaders = {}) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(text);
}

function redirect(res, location, statusCode = 302) {
  res.statusCode = statusCode;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.end();
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader('Allow', allowedMethods.join(', '));
  writeJson(res, 405, { error: 'Method Not Allowed' });
}

function sendError(res, error) {
  const statusCode = error && error.statusCode ? error.statusCode : 500;
  const payload = { error: error && error.message ? error.message : 'Internal Server Error' };
  if (error && error.details !== undefined) payload.details = error.details;
  writeJson(res, statusCode, payload);
}

module.exports = {
  createHttpError,
  methodNotAllowed,
  normalizeQueryValue,
  redirect,
  sendError,
  writeJson,
  writeText,
};
