const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// Stub the two things the handler reaches outside the process for — Deye Cloud
// and Supabase — so the request path itself can be exercised offline.
const stubs = {
  deye: { stations: [], total: 0 },
  sites: [],
  membershipRole: 'admin',
  authError: null,
  inserted: [],
  updates: [],
};

function stubModule(relativePath, exports) {
  const resolved = require.resolve(path.join(__dirname, relativePath));
  require.cache[resolved] = new Module(resolved, null);
  require.cache[resolved].filename = resolved;
  require.cache[resolved].loaded = true;
  require.cache[resolved].exports = exports;
}

stubModule('../api/_lib/auth-context.js', {
  async getAuthenticatedSessionContext() {
    if (stubs.authError) throw stubs.authError;
    return { membership: { organization: 'hisolar', role: stubs.membershipRole, status: 'approved' } };
  },
});

stubModule('../api/_lib/deye-cloud.js', {
  // The handler destructures this at require time, so the failure case is
  // driven through the stub's own state rather than by swapping the export.
  async listAllStations() {
    if (stubs.deyeError) throw stubs.deyeError;
    return { stations: stubs.deye.stations, total: stubs.deye.total };
  },
});

const realAdmin = require('../api/_lib/supabase-admin.js');
stubModule('../api/_lib/supabase-admin.js', {
  ...realAdmin,
  async listSitesForSync() { return stubs.sites; },
  async insertSites(rows) {
    stubs.inserted = rows;
    return rows.map((row, i) => ({
      id: `new-${i}`,
      site_code: `HS-99${i}`,
      site_name: row.site_name,
      platform_plant_id: row.platform_plant_id,
    }));
  },
  async updateSite(id, patch) { stubs.updates.push({ id, patch }); },
});

const handler = require('../api/sites/sync-deye.js');

function station(overrides = {}) {
  return {
    id: 700001,
    name: 'บ้านคุณเอ',
    locationLat: 18.7,
    locationLng: 98.9,
    locationAddress: 'เชียงใหม่',
    regionTimezone: 'Asia/Bangkok',
    installedCapacity: 5.5,
    startOperatingTime: 1705597200,
    connectionStatus: 'NORMAL',
    contactPhone: '',
    ownerName: null,
    ...overrides,
  };
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(text) { this.body = text ? JSON.parse(text) : null; },
  };
}

async function call(body, method = 'POST') {
  const res = fakeRes();
  await handler({ method, headers: {}, body }, res);
  return res;
}

test.beforeEach(() => {
  stubs.deye = { stations: [], total: 0 };
  stubs.deyeError = null;
  stubs.sites = [];
  stubs.membershipRole = 'admin';
  stubs.authError = null;
  stubs.inserted = [];
  stubs.updates = [];
});

test('only POST is accepted', async () => {
  const res = await call({}, 'GET');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('a viewer cannot sync even though the button is only hidden client-side', async () => {
  stubs.membershipRole = 'viewer';
  const res = await call({ dryRun: true });
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /admin or member/);
});

test('an expired session is refused before Deye is ever called', async () => {
  const error = new Error('Session expired or invalid');
  error.statusCode = 401;
  stubs.authError = error;
  const res = await call({ dryRun: true });
  assert.equal(res.statusCode, 401);
});

test('a dry run reports the plan and writes nothing', async () => {
  stubs.deye = { stations: [station(), station({ id: 700002, name: 'บ้านคุณบี' })], total: 2 };
  stubs.sites = [{
    id: 'existing-1', site_code: 'HS-0100', site_name: 'บ้านคุณเอ',
    platform_code: 'SOLARMAN', platform_plant_id: '3030254',
  }];

  const res = await call({ dryRun: true });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dryRun, true);
  assert.deepEqual(res.body.counts, { toInsert: 1, toUpdate: 0, duplicates: 1 });
  assert.equal(res.body.newSites[0].siteName, 'บ้านคุณบี');
  assert.equal(res.body.duplicates[0].matchedSiteCode, 'HS-0100');
  assert.equal(res.body.applied, undefined);
  assert.equal(stubs.inserted.length, 0);
  assert.equal(stubs.updates.length, 0);
});

test('the body defaults to a dry run, so a bare POST cannot write by accident', async () => {
  stubs.deye = { stations: [station()], total: 1 };
  const res = await call({});
  assert.equal(res.body.dryRun, true);
  assert.equal(stubs.inserted.length, 0);
});

test('applying the plan inserts the new sites and reports their site codes', async () => {
  stubs.deye = { stations: [station(), station({ id: 700002, name: 'บ้านคุณบี' })], total: 2 };
  stubs.sites = [{
    id: 'existing-1', site_code: 'HS-0100', site_name: 'บ้านคุณเอ',
    platform_code: 'SOLARMAN', platform_plant_id: '3030254',
  }];

  const res = await call({ dryRun: false });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.applied.inserted, 1);
  assert.equal(res.body.applied.updated, 0);
  assert.equal(res.body.applied.insertedSites[0].siteName, 'บ้านคุณบี');
  assert.equal(stubs.inserted.length, 1);
  assert.equal(stubs.inserted[0].platform_code, 'DEYECLOUD');
  assert.equal(stubs.inserted[0].site_code, undefined); // the trigger assigns it
});

test('running it twice updates rather than inserting a second copy', async () => {
  stubs.deye = { stations: [station({ connectionStatus: 'OFFLINE' })], total: 1 };
  stubs.sites = [{
    id: 'existing-deye', site_code: 'HS-0272', site_name: 'บ้านคุณเอ',
    platform_code: 'DEYECLOUD', platform_plant_id: '700001',
    phone: '0811111111', latitude: 18.5, longitude: 98.5,
  }];

  const res = await call({ dryRun: false });

  assert.equal(res.body.applied.inserted, 0);
  assert.equal(res.body.applied.updated, 1);
  assert.equal(stubs.updates[0].id, 'existing-deye');
  assert.equal(stubs.updates[0].patch.status, 'Offline');
  // hand-collected values are left alone
  assert.equal(stubs.updates[0].patch.latitude, undefined);
  assert.equal(stubs.updates[0].patch.phone, undefined);
});

test('a Deye outage surfaces as an error instead of an empty successful sync', async () => {
  // An empty stationList must never be read as "the account has no stations"
  // and quietly do nothing — the caller has to see the failure.
  const failure = new Error('Deye token failed (HTTP 502)');
  failure.statusCode = 502;
  stubs.deyeError = failure;

  const res = await call({ dryRun: false });

  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /Deye token failed/);
  assert.equal(stubs.inserted.length, 0);
});
