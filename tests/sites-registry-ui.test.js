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

function loadNav({ withHelper = false } = {}) {
  // Include the maps sanitizer block so mapsHref is exercised with the real rule
  const start = sitesSource.indexOf('function isAllowedMapsHostname(url) {');
  const end = sitesSource.indexOf('function telHref(s)');
  assert.ok(start > 0 && end > start, 'nav helpers not found in sites.html');
  const context = {
    encodeURIComponent,
    URL,
    // withHelper: job-ui-helpers.js loaded. Otherwise the inline fallback runs.
    window: withHelper ? { JobUiHelpers: require('../job-ui-helpers') } : {},
    JOB_UI: withHelper ? require('../job-ui-helpers') : {},
  };
  vm.createContext(context);
  vm.runInContext(sitesSource.slice(start, end), context);
  return context;
}

test('a pasted maps link is refused unless it is an https Google Maps URL', () => {
  for (const withHelper of [true, false]) {
    const { sanitizeMapsUrl, getMapsValidationMessage } = loadNav({ withHelper });
    const where = withHelper ? 'with helper' : 'inline fallback';

    assert.equal(sanitizeMapsUrl('javascript:alert(1)'), null, `${where}: javascript:`);
    assert.equal(sanitizeMapsUrl('data:text/html,<svg/onload=alert(1)>'), null, `${where}: data:`);
    assert.equal(sanitizeMapsUrl('http://www.google.com/maps?q=1'), null, `${where}: plain http`);
    assert.equal(sanitizeMapsUrl('https://evil.example/maps?q=1'), null, `${where}: wrong host`);
    assert.equal(sanitizeMapsUrl('not a url'), null, `${where}: malformed`);
    assert.equal(sanitizeMapsUrl('https://maps.app.goo.gl/abc123'), 'https://maps.app.goo.gl/abc123', where);
    assert.match(getMapsValidationMessage('javascript:alert(1)'), /Google Maps|maps\.app\.goo\.gl/, where);
    assert.equal(getMapsValidationMessage(''), '', `${where}: empty is allowed`);
  }
});

test('a dangerous maps_url already in the database never reaches an href', () => {
  const { mapsHref } = loadNav();

  // Falls through to the address search rather than emitting the bad link
  assert.equal(
    mapsHref({ maps_url: 'javascript:alert(1)', address: 'อ.หางดง' }),
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('อ.หางดง')
  );
  assert.equal(mapsHref({ maps_url: 'javascript:alert(1)' }), null);
  // Quotes that would break out of the attribute come back encoded
  const injected = mapsHref({ maps_url: 'https://www.google.com/maps?q=" onclick="alert(1)' });
  assert.ok(injected.startsWith('https://www.google.com/maps'));
  assert.doesNotMatch(injected, /"/);
});

test('the form stores the sanitized maps link and blocks a bad one before saving', () => {
  const save = sitesSource.slice(
    sitesSource.indexOf('async function saveSiteEdits(s)'),
    sitesSource.indexOf('function renderSiteJobs(jobs)')
  );
  assert.match(save, /const safe = sanitizeMapsUrl\(next\)/);
  assert.match(save, /if \(!safe\) \{ show\('err', getMapsValidationMessage\(next\)\)/);
  assert.match(save, /next = safe/);
});

test('the CSV importer enforces the same maps link rule as the browser', () => {
  const importer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sites-csv.mjs'), 'utf8');
  const start = importer.indexOf('function sanitizeMapsUrl(value) {');
  const end = importer.indexOf('function loadEnv()');
  assert.ok(start > 0 && end > start, 'importer is missing its maps sanitizer');

  const context = { URL };
  vm.createContext(context);
  vm.runInContext(importer.slice(start, end), context);

  assert.equal(context.sanitizeMapsUrl('javascript:alert(1)'), null);
  assert.equal(context.sanitizeMapsUrl('https://evil.example/maps'), null);
  assert.equal(context.sanitizeMapsUrl('http://maps.google.com/x'), null);
  assert.equal(context.sanitizeMapsUrl('https://maps.app.goo.gl/abc'), 'https://maps.app.goo.gl/abc');
  // A bad link is reported as a row problem instead of being written
  assert.match(importer, /problems\.push\(`row \$\{i \+ 2\}: maps_url must be an https Google Maps/);
});

test('navigation prefers a captured pin over a saved link over the address text', () => {
  const { mapsHref } = loadNav();

  // A pin captured on site routes turn-by-turn to the exact point
  assert.equal(
    mapsHref({ latitude: 18.9, longitude: 98.9, maps_url: 'https://maps.app.goo.gl/x', address: 'somewhere' }),
    'https://www.google.com/maps/dir/?api=1&destination=18.9,98.9'
  );
  assert.equal(
    mapsHref({ latitude: null, longitude: null, maps_url: 'https://maps.app.goo.gl/x', address: 'somewhere' }),
    'https://maps.app.goo.gl/x'
  );
  // Address text is the last resort, and it must be encoded
  assert.equal(
    mapsHref({ address: 'อ.หางดง จ.เชียงใหม่' }),
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('อ.หางดง จ.เชียงใหม่')
  );
  assert.equal(mapsHref({}), null);
});

test('the registry reads coordinates so a captured pin is actually used', () => {
  // Without these columns in the select, sites.html silently falls back to the
  // address search even for sites a technician has already pinned.
  const load = sitesSource.slice(
    sitesSource.indexOf('async function loadSites()'),
    sitesSource.indexOf('async function loadCleanHistory()')
  );
  assert.match(load, /latitude,longitude/);
});

test('the detail sheet says whether navigation is exact or guessed from the address', () => {
  const { navSourceLabel } = loadNav();

  // Compared field by field: objects built inside the vm are cross-realm, so
  // deepStrictEqual would fail on the prototype alone.
  const pinned = navSourceLabel({ latitude: 18.9, longitude: 98.9 });
  assert.equal(pinned.text, 'พิกัดจากหน้างาน');
  assert.equal(pinned.exact, true);
  assert.equal(navSourceLabel({ maps_url: 'https://maps.app.goo.gl/x' }).exact, true);
  // Address-only has to be flagged, since 59 of the imported addresses have no
  // spaces at all and Google Maps cannot resolve them reliably
  assert.equal(navSourceLabel({ address: 'ประเทศไทยอ.หางดงต.หารแก้ว' }).exact, false);
  assert.equal(navSourceLabel({}).text, 'ยังนำทางไม่ได้');
});

test('the edit gate mirrors the RLS write policy, admin and member only', () => {
  assert.match(sitesSource, /const EDIT_ROLES = new Set\(\['admin', 'member'\]\)/);
  assert.match(sitesSource, /const canEditSites = \(\) => EDIT_ROLES\.has\(myRole\)/);
  // Role comes from /api/auth/me, not from anything the page can be told locally
  assert.match(sitesSource, /myRole = String\(auth\?\.membership\?\.role \|\| ''\)/);
  // The button is UX only; the note has to stay so nobody mistakes it for the boundary
  assert.match(sitesSource, /การซ่อนปุ่มเป็นแค่ UX ตัวกันจริงคือ RLS/);
});

test('the edit button is only rendered for roles allowed to write', () => {
  const panel = sitesSource.slice(
    sitesSource.indexOf('function renderSitePanel(s)'),
    sitesSource.indexOf('function renderSiteEditForm(s)')
  );
  assert.match(panel, /\$\{canEditSites\(\) \? `<button class="btn-edit" id="btnEditSite"/);
});

test('saving edits updates one site by id and never inserts', () => {
  const save = sitesSource.slice(
    sitesSource.indexOf('async function saveSiteEdits(s)'),
    sitesSource.indexOf('function renderSiteJobs(jobs)')
  );
  assert.match(save, /\.from\('hi_solar_sites'\)\.update\(patch\)\.eq\('id', s\.id\)/);
  assert.doesNotMatch(save, /\.insert\(|\.upsert\(/);
  // Only changed fields are sent, so a form round-trip cannot blank other columns
  assert.match(save, /if \(String\(before \?\? ''\) !== String\(next \?\? ''\)\) patch\[f\.key\] = next/);
  // A policy refusal has to read as a permissions problem, not as bad input
  assert.match(save, /42501\|row-level security/);
  assert.match(save, /ไม่มีสิทธิ์แก้ทะเบียนไซต์/);
});

// Render the real form with a stub document so the markup itself is checked,
// not just the source text around it.
function renderEditFormHtml(site) {
  // Markers must not contain newlines: sites.html uses CRLF, so "\n\n" never matches.
  const efStart = sitesSource.indexOf('const EDIT_FIELDS = [');
  const efEnd = sitesSource.indexOf('];', efStart) + 2;
  assert.ok(efStart > 0 && efEnd > efStart, 'EDIT_FIELDS not found in sites.html');
  const fields = sitesSource.slice(efStart, efEnd);
  const render = sitesSource.slice(
    sitesSource.indexOf('function renderSiteEditForm(s)'),
    sitesSource.indexOf('async function saveSiteEdits(s)')
  );

  const captured = {};
  const context = {
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    )),
    document: {
      getElementById(id) {
        if (id === 'sitePanel') return captured;
        return { set onclick(_fn) {} };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${fields}\n${render}\nrenderSiteEditForm(${JSON.stringify(site)});`, context);
  return captured.innerHTML || '';
}

test('the edit form renders an input per editable field, pre-filled from the site', () => {
  const html = renderEditFormHtml({
    customer_name: 'สวนส้มจงลักษณ์',
    phone: '081-234-5678',
    contact_person: null,
    contact_method: '',
    clean_interval_months: 12,
    notes: 'ล้างปีละสองครั้ง',
  });

  for (const id of ['ef_customer_name', 'ef_phone', 'ef_contact_person', 'ef_contact_method', 'ef_clean_interval_months', 'ef_notes']) {
    assert.ok(html.includes(`id="${id}"`), `missing input ${id}`);
  }
  assert.match(html, /value="สวนส้มจงลักษณ์"/);
  assert.match(html, /value="081-234-5678"/);
  assert.match(html, /<textarea id="ef_notes">ล้างปีละสองครั้ง<\/textarea>/);
  // Empty and null both render as an empty field rather than "null"
  assert.match(html, /id="ef_contact_person"[^>]*value=""/);
  assert.doesNotMatch(html, /value="null"/);
  // The cycle field stays numeric so the keypad comes up on a phone
  assert.match(html, /id="ef_clean_interval_months" type="number"/);
  assert.ok(html.includes('id="btnSaveSite"') && html.includes('id="btnCancelEdit"'));
});

test('values from the database are escaped into the form, not injected', () => {
  const html = renderEditFormHtml({ customer_name: '" onfocus="alert(1)', notes: '<img src=x onerror=alert(1)>' });

  assert.doesNotMatch(html, /onfocus="alert/);
  assert.doesNotMatch(html, /<img/);
  assert.ok(html.includes('&quot; onfocus=&quot;alert(1)'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('the web form edits the same columns the CSV importer can write', () => {
  const importer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sites-csv.mjs'), 'utf8');
  const editable = importer.match(/const EDITABLE = \[(.*?)\]/s)[1];
  const formKeys = [...sitesSource.matchAll(/\{ key: '([a-z_]+)',/g)].map(m => m[1]);

  assert.ok(formKeys.length >= 6, 'expected the edit form to declare fields');
  for (const key of formKeys) {
    assert.ok(editable.includes(`'${key}'`), `${key} is editable in the web form but not in the CSV importer`);
  }
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
