const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  escapeHtml,
  buildTelHref,
  sanitizeMapsUrl,
  getCommentAuthorName,
  getCommentAuthorPicture,
  getCommentOrganizationLabel,
  getPermitAgeDays,
  getPermitAgeBucket,
  calculatePermitOverview,
} = require('../job-ui-helpers');

test('sanitizeMapsUrl rejects javascript and non-https URLs', () => {
  assert.equal(sanitizeMapsUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeMapsUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeMapsUrl('http://www.google.com/maps?q=13.7,100.5'), null);
});

test('sanitizeMapsUrl allows supported Google Maps hosts and neutralizes quote injection', () => {
  const safe = sanitizeMapsUrl('https://www.google.com/maps?q=" onclick="alert(1)');
  assert.ok(safe.startsWith('https://www.google.com/maps'));
  assert.doesNotMatch(safe, /"/);
  assert.ok(safe.includes('%22'));
  assert.equal(sanitizeMapsUrl('https://evil.example/maps?q=1'), null);
  assert.equal(
    sanitizeMapsUrl('https://maps.app.goo.gl/abc123'),
    'https://maps.app.goo.gl/abc123'
  );
});

test('sanitizeMapsUrl rewrites link shapes that fail to deep-link on iOS into the api=1 search form', () => {
  assert.equal(
    sanitizeMapsUrl('https://www.google.com/maps?q=13.7563,100.5018'),
    'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018'
  );
  assert.equal(
    sanitizeMapsUrl('https://www.google.com/maps/@13.7563,100.5018,17z'),
    'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018'
  );
  assert.equal(
    sanitizeMapsUrl('https://www.google.com/maps/place/Somewhere/data=!3d13.7563061!4d100.5018693'),
    'https://www.google.com/maps/search/?api=1&query=13.7563061,100.5018693'
  );
  // maps.app.goo.gl is an opaque short link with no coordinates to read out of
  // the URL itself, so it must pass through unchanged rather than be dropped.
  assert.equal(sanitizeMapsUrl('https://maps.app.goo.gl/abc123'), 'https://maps.app.goo.gl/abc123');
});

test('sanitizeMapsUrl prefers the place pin over the map pan/zoom center when a link carries both', () => {
  // A real "share this place" link often has the map's viewport center
  // (/@lat,lng,zoom) AND the place's own stored coordinate (!3d..!4d..) in the
  // same URL. The center drifts if the map was scrolled before copying the
  // link; the !3d/!4d pin is the one that actually marks the place.
  const placeLink =
    'https://www.google.com/maps/place/Customer+Site/@13.7,100.4,17z/data=!4m6!3m5!1s0x0:0x0!8m2!3d13.7437061!4d100.4888693';
  assert.equal(
    sanitizeMapsUrl(placeLink),
    'https://www.google.com/maps/search/?api=1&query=13.7437061,100.4888693'
  );
});

test('buildTelHref normalizes valid phone values and rejects malformed phones', () => {
  assert.equal(buildTelHref('081-234-5678'), 'tel:0812345678');
  assert.equal(buildTelHref('+66 81 234 5678'), 'tel:+66812345678');
  assert.equal(buildTelHref('08x-123-4567'), null);
});

function loadInlineMapsFallback(filename, { includeValidation = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const startToken = 'function isAllowedMapsHostname(url) {';
  const endToken = 'function parseCommentLog(source, fallbackNote = \'\') {';
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken);
  assert.ok(start >= 0, `${filename} is missing ${startToken}`);
  assert.ok(end > start, `${filename} is missing ${endToken}`);
  const snippet = source.slice(start, end);
  const context = vm.createContext({
    JOB_UI: {},
    URL,
  });
  vm.runInContext(`
${snippet}
this.inlineExports = {
  sanitizeMapsUrlFallback,
  sanitizeMapsUrl,
  ${includeValidation ? 'getMapsValidationMessage,' : ''}
  buildMapsActionButton
};
`, context, { filename });
  return context.inlineExports;
}

test('inline fallback sanitizer in both pages rejects dangerous URLs when JobUiHelpers is unavailable', () => {
  for (const filename of ['hisolar_planner.html', 'JDK.html']) {
    const { sanitizeMapsUrl, buildMapsActionButton } = loadInlineMapsFallback(filename);

    assert.equal(sanitizeMapsUrl('javascript:alert(1)'), null, `${filename} should reject javascript:`);
    assert.equal(sanitizeMapsUrl('data:text/html,<svg/onload=alert(1)>'), null, `${filename} should reject data:`);
    assert.equal(sanitizeMapsUrl('not a url'), null, `${filename} should reject malformed URLs`);
    assert.equal(sanitizeMapsUrl('https://evil.example/maps?q=1'), null, `${filename} should reject non-Google hosts`);

    const injected = sanitizeMapsUrl('https://www.google.com/maps?q=" onclick="alert(1)');
    assert.ok(injected.startsWith('https://www.google.com/maps'), `${filename} should keep valid Google Maps links`);
    assert.doesNotMatch(injected, /"/, `${filename} should encode quotes in sanitized URLs`);
    assert.equal(buildMapsActionButton('javascript:alert(1)'), '', `${filename} should not render a Maps button for dangerous URLs`);
  }
});

test('hisolar inline map validation blocks invalid URLs before save when helper is unavailable', () => {
  const { sanitizeMapsUrl, getMapsValidationMessage } = loadInlineMapsFallback('hisolar_planner.html', {
    includeValidation: true,
  });

  assert.equal(sanitizeMapsUrl('https://maps.app.goo.gl/abc123'), 'https://maps.app.goo.gl/abc123');
  assert.match(getMapsValidationMessage('javascript:alert(1)'), /https:\/\/|Google Maps|maps\.app\.goo\.gl/);
  assert.match(getMapsValidationMessage('data:text/html,boom'), /https:\/\/|Google Maps|maps\.app\.goo\.gl/);
  assert.match(getMapsValidationMessage('https://evil.example/maps?q=1'), /https:\/\/|Google Maps|maps\.app\.goo\.gl/);
  assert.match(getMapsValidationMessage('https://'), /https:\/\/|Google Maps|maps\.app\.goo\.gl/);
});

test('authenticated comments without LINE picture fall back to placeholder rendering data', () => {
  const comment = {
    actor_user_id: 'user-1',
    author_name_snapshot: 'Line User',
    author_picture_url_snapshot: null,
    organization: 'hisolar',
  };

  assert.equal(getCommentAuthorName(comment), 'Line User');
  assert.equal(getCommentAuthorPicture(comment), '');
  assert.equal(getCommentOrganizationLabel(comment), 'Hi Solar');
});

test('legacy comments keep old author name and fallback avatar', () => {
  const legacy = {
    actor_user_id: null,
    author: 'Legacy Staff',
    author_name_snapshot: 'Should Not Override Legacy Name',
    author_picture_url_snapshot: 'https://cdn.example/avatar.png',
    organization: null,
  };

  assert.equal(getCommentAuthorName(legacy), 'Legacy Staff');
  assert.equal(getCommentAuthorPicture(legacy), '');
  assert.equal(getCommentOrganizationLabel(legacy), '');
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('permit aging uses the last update and groups long-running open work', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');
  assert.equal(getPermitAgeDays({ updated_at:'2026-09-01T12:00:00.000Z', created_at:'2026-01-01T00:00:00.000Z' }, now), 6);
  assert.equal(getPermitAgeBucket({ updated_at:'2026-08-01T12:00:00.000Z' }, now), '31-60');
  assert.equal(getPermitAgeBucket({ created_at:'2026-06-01T00:00:00.000Z' }, now), '61+');
  assert.equal(getPermitAgeBucket({}, now), 'unknown');
});

test('permit overview counts status, phase, and aging without treating closed work as backlog', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');
  const overview = calculatePermitOverview([
    { status:'Waiting', phase:'เตรียมเอกสาร', updated_at:'2026-09-04T12:00:00.000Z' },
    { status:'In Progress', phase:'ยื่นเอกสาร', updated_at:'2026-08-01T12:00:00.000Z' },
    { status:'Need Fix', phase:'รับคำแนะนำ/แก้ไข', updated_at:'2026-06-01T12:00:00.000Z' },
    { status:'Done', phase:'ออกเอกสารขนานไฟฟ้า', updated_at:'2026-01-01T12:00:00.000Z' },
    { status:'Reject', phase:'ส่งเอกสาร', updated_at:'2026-01-01T12:00:00.000Z' },
  ], {
    statuses:['Waiting','In Progress','Need Fix','Done','Reject'],
    phases:['เตรียมเอกสาร','ส่งเอกสาร','รับคำแนะนำ/แก้ไข','ยื่นเอกสาร','ออกเอกสารขนานไฟฟ้า'],
    now,
  });

  assert.equal(overview.total, 5);
  assert.equal(overview.active, 3);
  assert.equal(overview.stale, 2);
  assert.equal(overview.statusCounts['Need Fix'], 1);
  assert.equal(overview.phaseCounts['ยื่นเอกสาร'], 1);
  assert.equal(overview.agingCounts['0-7'], 1);
  assert.equal(overview.agingCounts['31-60'], 1);
  assert.equal(overview.agingCounts['61+'], 1);
});

test('permit overview is mounted below search/date filters and exposes accessible controls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hisolar_planner.html'), 'utf8');
  const filterHost = source.indexOf('<div id="filterExtraHost-permit"></div>');
  const overviewHost = source.indexOf('<div id="permitOverviewHost"></div>');
  const listHost = source.indexOf('<div id="list-permit"></div>');

  assert.ok(filterHost >= 0 && overviewHost > filterHost && listHost > overviewHost);
  assert.match(source, /aria-label="ภาพรวมงานขออนุญาต"/);
  assert.match(source, /aria-expanded="\$\{permitOverviewOpen\}"/);
  assert.match(source, /localStorage\.setItem\('hiSolarPermitOverviewOpen'/);
  assert.doesNotMatch(source, /ขออนุญาติ/);
});

function loadInlineTeamOptions() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hisolar_planner.html'), 'utf8');
  const startToken = 'const TEAM_OPTIONS = [';
  const endToken = 'function formatCommentDateTime(';
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken);
  assert.ok(start >= 0, 'hisolar_planner.html is missing TEAM_OPTIONS');
  assert.ok(end > start, 'hisolar_planner.html is missing formatCommentDateTime');
  const context = vm.createContext({ escapeHtml });
  vm.runInContext(`
${source.slice(start, end)}
this.inlineExports = { TEAM_OPTIONS, teamOptionsHtml };
`, context);
  return context.inlineExports;
}

test('the team dropdown is a fixed roster of teams, not whoever logged in via LINE', () => {
  const { TEAM_OPTIONS, teamOptionsHtml } = loadInlineTeamOptions();

  assert.deepEqual([...TEAM_OPTIONS], [
    'Hi-Solar Only',
    'JDK-พี่อ๊อด',
    'JDK-พี่หล้า',
    'JDK-ช่างก้าว',
    'JDK-ช่างป๊อก',
  ]);

  const html = teamOptionsHtml();
  for (const team of TEAM_OPTIONS) {
    assert.ok(html.includes(`>${team}</option>`), `${team} is missing from the dropdown`);
  }
  assert.ok(html.includes('-- เลือกทีมงาน --'));
  assert.doesNotMatch(html, / selected/);
});

test('the saved team is preselected and an unknown legacy value survives editing', () => {
  const { teamOptionsHtml } = loadInlineTeamOptions();

  assert.ok(teamOptionsHtml('JDK-พี่หล้า').includes('value="JDK-พี่หล้า" selected'));

  const legacy = teamOptionsHtml('Shine Chaiwat');
  assert.ok(legacy.includes('value="Shine Chaiwat" selected'), 'legacy technician must not be silently dropped');
  assert.equal(legacy.match(/<option /g).length, 7);
});

test('a team name is escaped rather than injected into the dropdown', () => {
  const { teamOptionsHtml } = loadInlineTeamOptions();
  const html = teamOptionsHtml('" onclick="alert(1)');
  assert.doesNotMatch(html, /onclick="alert/);
  assert.ok(html.includes('&quot;'));
});
