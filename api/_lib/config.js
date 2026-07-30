const { createHttpError } = require('./http');

const APP_NAMES = new Set(['hisolar', 'jdk']);
const DEFAULT_LINE_PROVIDER_NAMESPACE = 'hisolar-tracker-line';

const APP_SETTINGS = {
  hisolar: {
    // home.html คือ launcher หลังล็อกอิน ส่วนหน้าอื่นเปิดตรงได้ผ่าน return_to
    // (เข้าลิงก์ลึกโดยไม่มี session -> ล็อกอินแล้วกลับมาหน้าเดิม)
    successPath: '/home.html',
    pendingPath: '/index.html?approval=pending&app=hisolar',
    extraReturnPaths: [
      '/hisolar_planner.html',
      '/sites.html',
      '/map.html',
      '/link-jobs.html',
    ],
  },
  jdk: {
    successPath: '/JDK.html',
    pendingPath: '/JDK.html?approval=pending&app=jdk',
    extraReturnPaths: [],
  },
};

function normalizeApp(app) {
  const value = String(app || '').trim();
  return APP_NAMES.has(value) ? value : null;
}

function getCookieNames() {
  return {
    flow: process.env.AUTH_FLOW_COOKIE_NAME || 'hs_auth_flow',
    session: process.env.AUTH_SESSION_COOKIE_NAME || 'hs_session',
  };
}

function getSessionMaxAgeSeconds() {
  const raw = Number.parseInt(process.env.AUTH_SESSION_MAX_AGE_SECONDS || '604800', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 604800;
}

function getAuthCookieSecret() {
  const secret = process.env.AUTH_SESSION_SECRET || '';
  if (!secret) {
    throw createHttpError(500, 'AUTH_SESSION_SECRET is not configured');
  }
  return secret;
}

// Dashboard-pasted env values pick up stray whitespace, and LINE compares
// redirect_uri byte for byte -- a leading tab is enough to fail the callback.
function readEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function getLineLoginConfig() {
  const channelId = readEnv('LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_HISOLAR_CHANNEL_ID');
  const channelSecret = readEnv('LINE_LOGIN_CHANNEL_SECRET', 'LINE_LOGIN_HISOLAR_CHANNEL_SECRET');
  const callbackUrl = readEnv('LINE_LOGIN_CALLBACK_URL', 'LINE_LOGIN_HISOLAR_CALLBACK_URL');
  const providerNamespace =
    readEnv('LINE_LOGIN_PROVIDER_NAMESPACE') || DEFAULT_LINE_PROVIDER_NAMESPACE;

  if (!channelId || !channelSecret || !callbackUrl) {
    throw createHttpError(500, 'Missing shared LINE Login configuration');
  }
  if (!providerNamespace) {
    throw createHttpError(500, 'LINE_LOGIN_PROVIDER_NAMESPACE is not configured');
  }

  return {
    channelId,
    channelSecret,
    callbackUrl,
    providerNamespace,
  };
}

function getAppConfig(app) {
  const normalized = normalizeApp(app);
  if (!normalized) throw createHttpError(400, 'Invalid app');
  const settings = APP_SETTINGS[normalized];
  const login = getLineLoginConfig();
  return {
    app: normalized,
    channelId: login.channelId,
    channelSecret: login.channelSecret,
    callbackUrl: login.callbackUrl,
    providerNamespace: login.providerNamespace,
    successPath: settings.successPath,
    pendingPath: settings.pendingPath,
    redirectAllowlist: new Set([settings.successPath, ...(settings.extraReturnPaths || [])]),
  };
}

function resolveReturnTo(app, requestedPath) {
  const config = getAppConfig(app);
  if (!requestedPath) return config.successPath;
  const value = String(requestedPath);
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('://')) {
    throw createHttpError(400, 'Invalid return_to');
  }
  if (!config.redirectAllowlist.has(value)) {
    throw createHttpError(400, 'return_to is not allowed');
  }
  return value;
}

module.exports = {
  DEFAULT_LINE_PROVIDER_NAMESPACE,
  getAppConfig,
  getAuthCookieSecret,
  getCookieNames,
  getLineLoginConfig,
  getSessionMaxAgeSeconds,
  normalizeApp,
  resolveReturnTo,
};
