const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sitesSource = fs.readFileSync(path.join(__dirname, '..', 'sites.html'), 'utf8');

// Run the real derivation helpers out of sites.html instead of copying them,
// so the test fails if the page and the rules drift apart.
function loadDerivation(lastCleanBySite = {}) {
  const start = sitesSource.indexOf('// ── Warranty / service derivation ─');
  const end = sitesSource.indexOf('// ── Data ─', start);
  assert.ok(start > 0 && end > start, 'derivation block not found in sites.html');

  const context = {
    WARRANTY_YEARS: 2,
    WARRANTY_SOON_DAYS: 90,
    DEFAULT_CLEAN_MONTHS: 6,
    CLEAN_SOON_DAYS: 30,
    lastCleanBySite,
  };
  vm.createContext(context);
  vm.runInContext(sitesSource.slice(start, end), context);
  return context;
}

// sites.html parses dates as local midnight, so format in local time too --
// toISOString() would shift the day backwards in any positive UTC offset.
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function shiftDays(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return iso(d);
}
function shiftMonths(months) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + months);
  return iso(d);
}

test('warranty runs two years from the commissioning date', () => {
  const { warrantyStateOf } = loadDerivation();

  assert.equal(warrantyStateOf({ grid_connection_date: shiftMonths(-12) }), 'active');
  assert.equal(warrantyStateOf({ grid_connection_date: shiftMonths(-36) }), 'expired');
  assert.equal(warrantyStateOf({ grid_connection_date: null }), 'unknown');
});

test('warranty flags the last 90 days before expiry as ending soon', () => {
  const { warrantyStateOf } = loadDerivation();

  // COD 2 years ago plus 30 days left => inside the 90-day window
  assert.equal(warrantyStateOf({ grid_connection_date: shiftDays(-(730 - 30)) }), 'soon');
  // 120 days left => still comfortably active
  assert.equal(warrantyStateOf({ grid_connection_date: shiftDays(-(730 - 120)) }), 'active');
});

test('a recorded warranty expiry overrides the two-year default', () => {
  const { warrantyStateOf, warrantyExpiryOf } = loadDerivation();
  const site = {
    grid_connection_date: shiftMonths(-60),      // would be expired on the default rule
    warranty_panel_expiry: shiftMonths(12),      // but a real expiry says otherwise
  };

  assert.equal(warrantyStateOf(site), 'active');
  assert.equal(iso(warrantyExpiryOf(site)), shiftMonths(12));
});

test('service cycle counts from the last recorded cleaning', () => {
  const { serviceOf } = loadDerivation({ recent: shiftMonths(-1), stale: shiftMonths(-8) });

  assert.equal(serviceOf({ id: 'recent', grid_connection_date: shiftMonths(-40) }).state, 'ok');
  assert.equal(serviceOf({ id: 'stale', grid_connection_date: shiftMonths(-40) }).state, 'overdue');
});

test('service cycle falls back to the commissioning date when nothing was ever cleaned', () => {
  const { serviceOf } = loadDerivation();

  assert.equal(serviceOf({ id: 'x', grid_connection_date: shiftMonths(-36) }).state, 'overdue');
  assert.equal(serviceOf({ id: 'x', grid_connection_date: shiftMonths(-1) }).state, 'ok');
  // No commissioning date and no cleaning history leaves nothing to count from
  assert.equal(serviceOf({ id: 'x', grid_connection_date: null }).state, 'never');
});

test('an explicit next_clean_date wins over the derived cycle', () => {
  const { serviceOf } = loadDerivation({ x: shiftMonths(-8) });

  const site = { id: 'x', grid_connection_date: shiftMonths(-40), next_clean_date: shiftMonths(3) };
  assert.equal(serviceOf(site).state, 'ok');
});

test('a per-site cleaning interval overrides the default', () => {
  const { serviceOf } = loadDerivation({ x: shiftMonths(-8) });

  // 8 months since the last clean is overdue on a 6-month cycle, fine on a 12-month one
  assert.equal(serviceOf({ id: 'x', clean_interval_months: 6 }).state, 'overdue');
  assert.equal(serviceOf({ id: 'x', clean_interval_months: 12 }).state, 'ok');
});

test('summary cards and brand chips are driven by the filtered set, not the whole registry', () => {
  const summary = sitesSource.slice(
    sitesSource.indexOf('function renderSummary()'),
    sitesSource.indexOf('function renderChips()')
  );
  assert.match(summary, /const rows = visibleSites\(\)/);
  assert.doesNotMatch(summary, /allSites/);

  const chips = sitesSource.slice(
    sitesSource.indexOf('function renderChips()'),
    sitesSource.indexOf('function renderActiveFilters()')
  );
  // Brand chips exclude their own dimension so the other brands stay selectable
  assert.match(chips, /visibleSites\('brand'\)/);
});

test('every chart excludes its own dimension so its other buckets stay reachable', () => {
  assert.match(sitesSource, /function renderYearChart\(\)\s*\{\s*const rows = visibleSites\('year'\)/);
  assert.match(sitesSource, /rows: visibleSites\('warranty'\), stateOf: warrantyStateOf/);
  assert.match(sitesSource, /const svcRows = visibleSites\('service'\)/);
  assert.match(sitesSource, /function renderBrandKwpChart\(\)\s*\{\s*const rows = visibleSites\('brand'\)/);
});

test('filter changes redraw the stats and charts, not just the list', () => {
  const wired = sitesSource.slice(sitesSource.indexOf('function wireEvents()'));
  // Search and brand chips previously called renderList() alone, which left the
  // summary cards showing registry-wide totals.
  assert.match(wired, /searchTerm = q\.value; renderAll\(\);/);
  assert.match(wired, /brandFilter = chip\.dataset\.brand;\s*renderAll\(\);/);
  assert.match(wired, /renderAll\(\);/);
});

test('site cards carry a warranty or service pill and service takes precedence', () => {
  const list = sitesSource.slice(
    sitesSource.indexOf('function renderList()'),
    sitesSource.indexOf('// ── Detail sheet ─')
  );
  assert.match(list, /const w = warrantyStateOf\(s\)/);
  assert.match(list, /const svc = serviceOf\(s\)/);
  // Overdue service outranks warranty state because it is the actionable one
  assert.match(list, /svc\.state === 'overdue'[\s\S]*?ถึงรอบบริการ/);
  assert.match(list, /class="wpill \$\{pill\.cls\}"/);
});
