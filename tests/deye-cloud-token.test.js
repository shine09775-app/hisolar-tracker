const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEYE_APP_ID = 'test-app-id';
process.env.DEYE_APP_SECRET = 'test-app-secret';
process.env.DEYE_EMAIL = 'ops@hisolarthailand.com';
process.env.DEYE_PASSWORD = 'not-the-real-one';

const { __resetTokenCache, getDeyeConfig, listAllStations } = require('../api/_lib/deye-cloud');

const SIXTY_DAYS = '5183999';
const realFetch = global.fetch;
let calls = [];
let routes = {};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

test.beforeEach(() => {
  __resetTokenCache();
  calls = [];
  delete process.env.DEYE_COMPANY_ID;
  global.fetch = async (url, options) => {
    const body = options && options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), body, authorization: options?.headers?.authorization });
    for (const [fragment, handler] of Object.entries(routes)) {
      if (String(url).includes(fragment)) return handler(body, calls.length);
    }
    throw new Error(`unexpected call to ${url}`);
  };
});

test.after(() => { global.fetch = realFetch; });

// A business account's plants belong to the company, not the person, so the
// token has to be issued a second time carrying companyId. Without it Deye
// answers 200 with an empty stationList — a failure that looks like success.
test('a business account re-issues the token scoped to its organisation', async () => {
  routes = {
    '/v1.0/account/token': (body) => jsonResponse({
      success: true,
      accessToken: body.companyId ? 'company-token' : 'personal-token',
      expiresIn: SIXTY_DAYS,
    }),
    '/v1.0/account/info': () => jsonResponse({
      success: true,
      orgInfoList: [{ companyId: 963, companyName: 'Hi Solar Sun Energy', roleName: 'Administrator' }],
    }),
    '/v1.0/station/list': () => jsonResponse({ success: true, total: 1, stationList: [{ id: 1, name: 'A' }] }),
  };

  const result = await listAllStations(getDeyeConfig());

  const tokenCalls = calls.filter(c => c.url.includes('/account/token'));
  assert.equal(tokenCalls.length, 2);
  assert.equal(tokenCalls[0].body.companyId, undefined);
  assert.equal(tokenCalls[1].body.companyId, 963);

  // the station list must go out with the company-scoped token, not the first one
  const listCall = calls.find(c => c.url.includes('/station/list'));
  assert.equal(listCall.authorization, 'Bearer company-token');

  assert.equal(result.companyId, 963);
  assert.equal(result.companyName, 'Hi Solar Sun Energy');
  assert.equal(result.stations.length, 1);
});

test('a personal account is left on its first token and never calls token twice', async () => {
  routes = {
    '/v1.0/account/token': () => jsonResponse({ success: true, accessToken: 'personal-token', expiresIn: SIXTY_DAYS }),
    '/v1.0/account/info': () => jsonResponse({ success: true, orgInfoList: [] }),
    '/v1.0/station/list': () => jsonResponse({ success: true, total: 0, stationList: [] }),
  };

  const result = await listAllStations(getDeyeConfig());

  assert.equal(calls.filter(c => c.url.includes('/account/token')).length, 1);
  assert.equal(calls.find(c => c.url.includes('/station/list')).authorization, 'Bearer personal-token');
  assert.equal(result.companyId, null);
});

test('several organisations refuse to guess and name the choices', async () => {
  routes = {
    '/v1.0/account/token': () => jsonResponse({ success: true, accessToken: 'personal-token', expiresIn: SIXTY_DAYS }),
    '/v1.0/account/info': () => jsonResponse({
      success: true,
      orgInfoList: [
        { companyId: 963, companyName: 'Hi Solar Sun Energy', roleName: 'Administrator' },
        { companyId: 999, companyName: 'Other Co', roleName: 'Developer' },
      ],
    }),
  };

  await assert.rejects(
    () => listAllStations(getDeyeConfig()),
    (error) => {
      assert.equal(error.statusCode, 500);
      assert.match(error.message, /DEYE_COMPANY_ID/);
      // the details have to be enough to pick one without another round trip
      assert.match(error.details, /963 = Hi Solar Sun Energy/);
      assert.match(error.details, /999 = Other Co/);
      return true;
    }
  );
});

test('DEYE_COMPANY_ID skips discovery and scopes the token directly', async () => {
  process.env.DEYE_COMPANY_ID = '963';
  routes = {
    '/v1.0/account/token': () => jsonResponse({ success: true, accessToken: 'company-token', expiresIn: SIXTY_DAYS }),
    '/v1.0/station/list': () => jsonResponse({ success: true, total: 0, stationList: [] }),
  };

  const result = await listAllStations(getDeyeConfig());

  assert.equal(calls.filter(c => c.url.includes('/account/info')).length, 0);
  assert.equal(calls[0].body.companyId, 963);
  assert.equal(result.companyId, 963);
});

test('a non-numeric DEYE_COMPANY_ID is rejected before any request goes out', () => {
  process.env.DEYE_COMPANY_ID = 'Hi Solar Sun Energy';
  assert.throws(() => getDeyeConfig(), (error) => {
    assert.equal(error.statusCode, 500);
    assert.match(error.message, /DEYE_COMPANY_ID must be a number/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('appId rides in the query string and the password is sent hashed', async () => {
  routes = {
    '/v1.0/account/token': () => jsonResponse({ success: true, accessToken: 't', expiresIn: SIXTY_DAYS }),
    '/v1.0/account/info': () => jsonResponse({ success: true, orgInfoList: [] }),
    '/v1.0/station/list': () => jsonResponse({ success: true, total: 0, stationList: [] }),
  };

  await listAllStations(getDeyeConfig());

  const tokenCall = calls[0];
  assert.match(tokenCall.url, /\/v1\.0\/account\/token\?appId=test-app-id$/);
  assert.equal(tokenCall.body.email, 'ops@hisolarthailand.com');
  // sha256 of the plaintext, lowercase hex — never the plaintext itself
  assert.match(tokenCall.body.password, /^[0-9a-f]{64}$/);
  assert.notEqual(tokenCall.body.password, 'not-the-real-one');
});

test('success:false is treated as a failure even though the status is 200', async () => {
  routes = {
    '/v1.0/account/token': () => jsonResponse({ success: false, code: '1000404', msg: 'account does not exist' }),
  };

  await assert.rejects(() => listAllStations(getDeyeConfig()), (error) => {
    assert.equal(error.statusCode, 502);
    assert.match(error.details, /account does not exist/);
    return true;
  });
});

test('a second sync reuses the cached token instead of logging in again', async () => {
  routes = {
    '/v1.0/account/token': () => jsonResponse({ success: true, accessToken: 't', expiresIn: SIXTY_DAYS }),
    '/v1.0/account/info': () => jsonResponse({ success: true, orgInfoList: [] }),
    '/v1.0/station/list': () => jsonResponse({ success: true, total: 0, stationList: [] }),
  };

  await listAllStations(getDeyeConfig());
  const afterFirst = calls.filter(c => c.url.includes('/account/token')).length;
  await listAllStations(getDeyeConfig());

  assert.equal(afterFirst, 1);
  assert.equal(calls.filter(c => c.url.includes('/account/token')).length, 1);
});

test('paging stops once the reported total has been collected', async () => {
  const page = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `S${i}` }));
  routes = {
    '/v1.0/account/token': () => jsonResponse({ success: true, accessToken: 't', expiresIn: SIXTY_DAYS }),
    '/v1.0/account/info': () => jsonResponse({ success: true, orgInfoList: [] }),
    '/v1.0/station/list': (body) => jsonResponse({
      success: true,
      total: 250,
      stationList: body.page === 1 ? page(200) : page(50),
    }),
  };

  const result = await listAllStations(getDeyeConfig());

  assert.equal(calls.filter(c => c.url.includes('/station/list')).length, 2);
  assert.equal(result.stations.length, 250);
});
