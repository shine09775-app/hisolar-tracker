const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Suggestions used to be dominated by noise: 517 shown across the real 125 jobs,
// 502 of them from name tokens, and the worst offenders were words that identify
// nobody. One job matched 20+ sites because both sides contained the honorific
// "คุณ", and "คุณโดนันท์ คุณ" scored 70% against "คุณ วิชิตค้าส่ง แม่สอด" on two
// hits that were both the honorific. The real match for that job was buried.
//
// These tests run the shipped scorer so the rules cannot quietly loosen again.

const source = fs.readFileSync(path.join(__dirname, '..', 'link-jobs.html'), 'utf8');

function loadScorer(siteNames) {
  const start = source.indexOf('function digits(s)');
  const end = source.indexOf('// ── Data ─');
  assert.ok(start > 0 && end > start, 'scoring block not found in link-jobs.html');

  const context = {
    sites: siteNames.map((site, i) =>
      typeof site === 'string' ? { id: `s${i}`, site_name: site } : { id: `s${i}`, ...site }
    ),
    norm: (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nrebuildCommonSiteTokens();`, context);
  return {
    score: (job, siteName) =>
      context.scoreSite(
        typeof job === 'string' ? { customer_name: job } : job,
        context.sites.find(s => s.site_name === siteName)
      ),
    suggest: (job) => context.suggestionsFor(typeof job === 'string' ? { customer_name: job } : job),
  };
}

test('a shared honorific alone is not a match', () => {
  const { score, suggest } = loadScorer(['คุณ วิชิตค้าส่ง แม่สอด', 'บ้านคุณ ธีรภาพ', 'ร้านคุณเกื้อ']);

  assert.equal(score('คุณ Tap — กาญจนกนก 19', 'คุณ วิชิตค้าส่ง แม่สอด'), 0);
  assert.equal(score('คุณแดง คุณ Alan', 'คุณ วิชิตค้าส่ง แม่สอด'), 0);
  // The 70% case: both hits were the honorific
  assert.equal(score('คุณโดนันท์ คุณ', 'คุณ วิชิตค้าส่ง แม่สอด'), 0);
  assert.equal(suggest('คุณ Tap — กาญจนกนก 19').length, 0);
});

test('an honorific glued to the front of a Thai name is stripped before comparing', () => {
  const { score } = loadScorer(['บ้านคุณ ธีรภาพ', 'บ้านคุณเต็มดวง', 'บ้านคุณผึ้ง 5 Kw']);

  // "บ้านคุณทับทิม" and "บ้านคุณ ธีรภาพ" share only the prefix
  assert.equal(score('บ้านคุณทับทิม', 'บ้านคุณ ธีรภาพ'), 0);
  // The name after the prefix still matches
  assert.equal(score('คุณเต็มดวง — สันป่าตอง', 'บ้านคุณเต็มดวง'), 52);
});

test('punctuation is split off so a bracketed generic word cannot match', () => {
  const { score } = loadScorer(['PANTAI HOME', 'NOOK HOME', 'Sorawit home']);

  // Previously tokenized as "home)" which slipped past the stopword check
  assert.equal(score('คุณ Tap — กาญจนกนก 19 (Sorawit home)', 'PANTAI HOME'), 0);
  assert.equal(score('คุณ Tap — กาญจนกนก 19 (Sorawit home)', 'NOOK HOME'), 0);
  // The actual match for that job, which the noise used to bury
  assert.equal(score('คุณ Tap — กาญจนกนก 19 (Sorawit home)', 'Sorawit home'), 78);
});

test('a shared district or business type is not a shared customer', () => {
  const { score } = loadScorer([
    'อบต. หางดง ฮอด',
    'วัดศรีดอนมูล สารภี',
    'คลินิก ฟ.ฟันแม่สาย เชียงราย',
    'เทศบาลจอมทอง เชียงใหม่',
  ]);

  assert.equal(score('Rich Atlas ใกล้ Big C หางดง', 'อบต. หางดง ฮอด'), 0);
  assert.equal(score('คุณอาร์ม  สารภี', 'วัดศรีดอนมูล สารภี'), 0);
  assert.equal(score('คลินิกทันตกรรม / คุณโฮบ', 'คลินิก ฟ.ฟันแม่สาย เชียงราย'), 0);
  assert.equal(score('เชียงใหม่เลิศวศิน', 'เทศบาลจอมทอง เชียงใหม่'), 0);
});

test('a distinctive name still matches on a single token', () => {
  const { score } = loadScorer([
    'บริษัท ราชาน๊อตเลส กทม',
    'สวนส้มกำไลทอง',
    'บ้านศิลาดล เชียงไหม่',
    'บ้านผู้การชัยวัฒน์',
  ]);

  assert.equal(score('บริษัท ราชาน๊อต จำกัด', 'บริษัท ราชาน๊อตเลส กทม'), 52);
  assert.equal(score('ร้านกำไลทอง', 'สวนส้มกำไลทอง'), 52);
  assert.equal(score('บริษัท บ้านศิลาดล จำกัด', 'บ้านศิลาดล เชียงไหม่'), 52);
  assert.equal(score('ชัยวัฒน์ (พี่ชาย)', 'บ้านผู้การชัยวัฒน์'), 52);
});

test('short tokens must match exactly, so a three-letter fragment cannot pair names', () => {
  const { score } = loadScorer(['ABC Trading', 'XYZ Farm']);

  // "abcdefgh" contains "abc", but three characters are not an identity
  assert.equal(score('abcdefgh Ltd', 'ABC Trading'), 0);
});

test('words shared across many sites are dropped from the data, not just the list', () => {
  // "metro" is on 12 of 13 sites here, so it identifies nobody even though no
  // stopword list mentions it. The cut is derived from the registry, so it keeps
  // working for words this code has never seen.
  const repeated = Array.from({ length: 12 }, (_, i) => `Metro Plant ${i + 1}`);
  const { score } = loadScorer([...repeated, 'Unique Orchard']);

  assert.equal(score('Metro Something Else', 'Metro Plant 1'), 0);
  // A word on a single site still counts
  assert.equal(score('Orchard supply', 'Unique Orchard'), 52);
});

test('exact, containment, phone and maps signals are unchanged', () => {
  const { score } = loadScorer([
    'Kulisara',
    'Groove Music School',
    { site_name: 'Hub53 Co Working Space', contact_method: 'ติดต่อ 081-234-5678' },
    { site_name: 'Pinned Site', maps_url: 'https://maps.app.goo.gl/abc123' },
  ]);

  assert.equal(score('Kulisara', 'Kulisara'), 100);
  assert.equal(score('Groove Music School (LuisSethakorn)', 'Groove Music School'), 78);
  assert.equal(
    score({ customer_name: 'ชัยวัฒน์ (พี่ชาย)', phone: '0812345678' }, 'Hub53 Co Working Space'),
    92
  );
  assert.equal(
    score(
      { customer_name: 'somebody', maps_url: 'https://maps.app.goo.gl/abc123' },
      'Pinned Site'
    ),
    95
  );
});

test('a job with nothing in common gets no suggestions at all', () => {
  const { suggest } = loadScorer(['บ้านคุณ ธีรภาพ', 'PANTAI HOME', 'อบต. หางดง ฮอด']);

  assert.deepEqual(suggest('สวนส้มจงลักษณ์').map(x => x.sc), []);
  assert.equal(suggest({ customer_name: 'แหม่ม' }).length, 0);
});

test('suggestions stay capped and ordered strongest first', () => {
  const { suggest } = loadScorer([
    'Kulisara',
    'Kulisara Garden',
    'Kulisara Farm 2',
    'Kulisara Site 4',
  ]);

  const out = suggest('Kulisara');
  assert.ok(out.length <= 3, 'no more than three candidates');
  assert.deepEqual([...out].sort((a, b) => b.sc - a.sc).map(x => x.sc), out.map(x => x.sc));
  assert.equal(out[0].sc, 100);
});
