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
