// Deye Cloud OpenAPI client — https://developer.deyecloud.com
//
// Deye also publishes a remote MCP server at
// https://developer.deyecloud.com/openmcp/mcp, but that exists so an AI client
// can drive the account in natural language. It wraps this same REST API, so a
// scheduled/backend pull like ours talks to the REST API directly: no MCP
// session to keep alive, no SSE framing, one round trip per page.
//
// Env vars (set in Vercel):
//   DEYE_APP_ID            required  — OpenAPI application id
//   DEYE_APP_SECRET        required  — OpenAPI application secret
//   DEYE_EMAIL             required unless DEYE_MOBILE is set — account login
//   DEYE_MOBILE            alternative to DEYE_EMAIL (needs DEYE_COUNTRY_CODE)
//   DEYE_COUNTRY_CODE      only with DEYE_MOBILE, e.g. 66
//   DEYE_PASSWORD          account password (hashed here before it is sent)
//   DEYE_PASSWORD_SHA256   pre-hashed alternative, if you would rather not
//                          store the plaintext password in the dashboard
//   DEYE_REGION            eu (default) | am | india — must match the data
//                          centre the account was created in, otherwise the
//                          token call returns "account does not exist"
//   DEYE_COMPANY_ID        only needed when the account belongs to more than
//                          one organisation; a single one is found on its own

const { readCleanEnv } = require('./env');
const { createHttpError } = require('./http');
const { sha256Hex } = require('./security');

// from the MCP server's list_data_centers tool
const DATA_CENTERS = {
  eu: 'https://eu1-developer.deyecloud.com',
  am: 'https://us1-developer.deyecloud.com',
  india: 'https://india-developer.deyecloud.com',
};

// /v1.0/station/list caps size at 200 (default 20)
const STATION_PAGE_SIZE = 200;
// A runaway total would otherwise loop until the function times out.
const MAX_STATION_PAGES = 50;

const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

let cachedToken = null; // { token, expiresAtMs, region } — survives warm invocations

function getDeyeConfig() {
  const region = (process.env.DEYE_REGION || 'eu').trim().toLowerCase();
  const baseUrl = DATA_CENTERS[region];
  if (!baseUrl) {
    throw createHttpError(
      500,
      `DEYE_REGION "${region}" is not a Deye data centre`,
      `Use one of: ${Object.keys(DATA_CENTERS).join(', ')}`
    );
  }

  const appId = readCleanEnv('DEYE_APP_ID', {
    hint: 'Create an application at developer.deyecloud.com and copy its AppId into Vercel.',
  });
  const appSecret = readCleanEnv('DEYE_APP_SECRET', {
    hint: 'Create an application at developer.deyecloud.com and copy its AppSecret into Vercel.',
  });

  const email = String(process.env.DEYE_EMAIL || '').trim();
  const mobile = String(process.env.DEYE_MOBILE || '').trim();
  if (!email && !mobile) {
    throw createHttpError(500, 'DEYE_EMAIL or DEYE_MOBILE is not configured');
  }

  // The API wants the password already SHA-256 hashed. Accepting the plaintext
  // and hashing here keeps the Vercel dashboard entry obvious, but a
  // pre-hashed value is honoured so the plaintext never has to be stored.
  const passwordSha256 = String(process.env.DEYE_PASSWORD_SHA256 || '').trim()
    || (process.env.DEYE_PASSWORD ? sha256Hex(process.env.DEYE_PASSWORD) : '');
  if (!passwordSha256) {
    throw createHttpError(500, 'DEYE_PASSWORD or DEYE_PASSWORD_SHA256 is not configured');
  }

  // Optional: pins which organisation to sync. Only needed when the account
  // belongs to several — otherwise the single one is discovered automatically.
  const rawCompanyId = String(process.env.DEYE_COMPANY_ID || '').trim();
  const companyId = rawCompanyId ? Number.parseInt(rawCompanyId, 10) : null;
  if (rawCompanyId && !Number.isFinite(companyId)) {
    throw createHttpError(500, 'DEYE_COMPANY_ID must be a number', `Got "${rawCompanyId}"`);
  }

  return {
    appId,
    appSecret,
    baseUrl,
    companyId,
    countryCode: String(process.env.DEYE_COUNTRY_CODE || '').trim(),
    email,
    mobile,
    passwordSha256,
    region,
  };
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    throw createHttpError(502, `Deye ${label} returned a non-JSON response`, text.slice(0, 300));
  }
  if (!response.ok) {
    throw createHttpError(
      502,
      `Deye ${label} failed (HTTP ${response.status})`,
      payload && payload.msg ? payload.msg : undefined
    );
  }
  // Deye answers 200 with success:false for business errors (bad credentials,
  // wrong data centre, app not approved), so the status code alone is no proof.
  if (payload && payload.success === false) {
    throw createHttpError(
      502,
      `Deye ${label} rejected the request`,
      [payload.code, payload.msg].filter(Boolean).join(' ') || undefined
    );
  }
  return payload || {};
}

async function fetchAccessToken(config, companyId = null) {
  const body = { appSecret: config.appSecret, password: config.passwordSha256 };
  if (config.email) body.email = config.email;
  if (config.mobile) {
    body.mobile = config.mobile;
    if (config.countryCode) body.countryCode = config.countryCode;
  }
  if (companyId !== null) body.companyId = Number(companyId);

  const response = await fetch(
    `${config.baseUrl}/v1.0/account/token?appId=${encodeURIComponent(config.appId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const payload = await readJsonResponse(response, 'token');
  const accessToken = String(payload.accessToken || '').trim();
  if (!accessToken) {
    throw createHttpError(
      502,
      'Deye token response did not contain an accessToken',
      `Check DEYE_REGION — the account must live in the "${config.region}" data centre.`
    );
  }

  // expiresIn is seconds and typed as a string in the spec.
  const expiresInSeconds = Number.parseInt(payload.expiresIn, 10);
  const ttlMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? expiresInSeconds * 1000
    : 30 * 60 * 1000;

  return { token: accessToken, expiresAtMs: Date.now() + ttlMs };
}

// The organisations this account belongs to. Empty for a personal account.
async function fetchOrganizations(config, token) {
  const response = await fetch(`${config.baseUrl}/v1.0/account/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      authorization: withBearer(token),
    },
    body: '{}',
  });
  const payload = await readJsonResponse(response, 'account info');
  return Array.isArray(payload.orgInfoList) ? payload.orgInfoList : [];
}

// A business-member account needs the token issued twice. The first call
// authenticates the person; the stations belong to the *company*, so without a
// second call carrying companyId, /v1.0/station/list answers 200 with an empty
// list — which reads exactly like "this account has no plants" and is the one
// failure here that would look like success.
async function resolveAccessToken(config) {
  if (config.companyId) {
    const scoped = await fetchAccessToken(config, config.companyId);
    return { ...scoped, companyId: config.companyId, companyName: null };
  }

  const personal = await fetchAccessToken(config);
  const organizations = await fetchOrganizations(config, personal.token);

  if (!organizations.length) {
    // Genuinely a personal account — its own token already sees the plants.
    return { ...personal, companyId: null, companyName: null };
  }

  if (organizations.length > 1) {
    throw createHttpError(
      500,
      'This Deye account belongs to more than one organisation, so DEYE_COMPANY_ID must say which one to sync',
      organizations.map(org => `${org.companyId} = ${org.companyName} (${org.roleName})`).join(' · ')
    );
  }

  const org = organizations[0];
  const scoped = await fetchAccessToken(config, org.companyId);
  return { ...scoped, companyId: org.companyId, companyName: org.companyName || null };
}

async function getAccessToken(config) {
  const now = Date.now();
  if (
    cachedToken
    && cachedToken.region === config.region
    && cachedToken.expiresAtMs - TOKEN_EXPIRY_SKEW_MS > now
  ) {
    return cachedToken;
  }
  const fresh = await resolveAccessToken(config);
  cachedToken = { ...fresh, region: config.region };
  return cachedToken;
}

// The spec's own example prints the token already carrying "Bearer ", so the
// prefix is only added when it is not there already.
function withBearer(token) {
  return /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
}

async function callDeye(config, path, body) {
  const { token } = await getAccessToken(config);

  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      authorization: withBearer(token),
    },
    body: JSON.stringify(body || {}),
  });
  return readJsonResponse(response, path);
}

// Every station under the account, following pagination to the end.
async function listAllStations(config = getDeyeConfig()) {
  const stations = [];
  let total = null;

  for (let page = 1; page <= MAX_STATION_PAGES; page++) {
    const payload = await callDeye(config, '/v1.0/station/list', {
      page,
      size: STATION_PAGE_SIZE,
    });
    const batch = Array.isArray(payload.stationList) ? payload.stationList : [];
    stations.push(...batch);

    if (total === null && Number.isFinite(Number(payload.total))) total = Number(payload.total);
    if (batch.length < STATION_PAGE_SIZE) break;
    if (total !== null && stations.length >= total) break;
  }

  // Which organisation the token was scoped to — reported back so an empty
  // result can be told apart from a token pointing at the wrong company.
  const { companyId, companyName } = await getAccessToken(config);
  return {
    stations,
    total: total === null ? stations.length : total,
    companyId: companyId || null,
    companyName: companyName || null,
  };
}

module.exports = {
  DATA_CENTERS,
  STATION_PAGE_SIZE,
  callDeye,
  getDeyeConfig,
  listAllStations,
  // exported for tests
  __resetTokenCache: () => { cachedToken = null; },
};
