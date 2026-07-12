const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

function extractBetween(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  assert.ok(start >= 0, `Missing ${label} start token`);
  assert.ok(end > start, `Missing ${label} end token`);
  return source.slice(start, end);
}

function createElementStub() {
  return {
    style: {},
    textContent: '',
    innerHTML: '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
  };
}

async function runHtmlBootstrap(filename, options = {}) {
  const source = readRepoFile(filename);
  const script = extractBetween(
    source,
    '(async function init() {',
    '})();',
    `${filename} bootstrap`
  ) + '})();';

  const calls = [];
  const elementCache = new Map();
  const document = {
    getElementById(id) {
      if (!elementCache.has(id)) {
        elementCache.set(id, createElementStub());
      }
      return elementCache.get(id);
    },
  };

  const window = {
    HiSolarAuth: {
      async fetchAuthMe(app) {
        calls.push(`fetchAuthMe:${app}`);
        if (options.fetchAuthError) throw options.fetchAuthError;
        return { user: { id: 'user-1', displayName: 'Tester' }, membership: { organization: options.app } };
      },
      async ensureSupabaseClientLoaded() {
        calls.push('ensureSupabaseClientLoaded');
      },
      async refreshSupabaseToken(app) {
        calls.push(`refreshSupabaseToken:${app}`);
      },
      createSupabaseClient(app) {
        calls.push(`createSupabaseClient:${app}`);
        return { app };
      },
      getQueryParam(key) {
        return options.query?.[key] || '';
      },
    },
    location: {
      href: `${options.app || 'hisolar'}.html`,
      reload() {
        calls.push('reload');
      },
    },
  };

  const context = vm.createContext({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    console,
    currentAuth: null,
    document,
    loadData: async () => {
      calls.push('loadData');
      return options.loadDataResult ?? true;
    },
    renderAddForms: () => calls.push('renderAddForms'),
    applyAuthenticatedIdentity: () => calls.push('applyAuthenticatedIdentity'),
    initFilterExtras: () => calls.push('initFilterExtras'),
    initCommentInput: () => calls.push('initCommentInput'),
    wireMapsValidation: () => calls.push('wireMapsValidation'),
    setRealtimeIndicatorState: state => calls.push(`setRealtimeIndicatorState:${state}`),
    setAppVisible: visible => calls.push(`setAppVisible:${visible}`),
    hideAuthGate: () => calls.push('hideAuthGate'),
    setLoadingVisible: (_visible, message) => calls.push(`setLoadingVisible:${message || ''}`),
    setLoading: (_visible, message) => calls.push(`setLoading:${message || ''}`),
    renderAll: () => calls.push('renderAll'),
    updateStats: () => calls.push('updateStats'),
    updateBadges: () => calls.push('updateBadges'),
    setupRealtime: () => calls.push('setupRealtime'),
    redirectToIndex: (...args) => calls.push(`redirectToIndex:${JSON.stringify(args)}`),
    isAccessDeniedError: error => error?.status === 403,
    renderPlannerNetworkError: error => calls.push(`renderPlannerNetworkError:${error?.message || ''}`),
    renderJdkAuthState: state => calls.push(`renderJdkAuthState:${state}`),
    window,
  });

  await vm.runInContext(script, context, { filename });
  return calls;
}

function extractFunctionSnippet(source, startToken, endToken, label) {
  return extractBetween(source, startToken, endToken, label);
}

function extractPolicyNames(source, mode) {
  const pattern = mode === 'create'
    ? /create policy "([^"]+)"/g
    : /drop policy if exists "([^"]+)"/g;
  return new Set(Array.from(source.matchAll(pattern), match => match[1]));
}

test('Preflight: browser client stays authenticated and never falls back to anon', () => {
  const assets = ['index.html', 'hisolar_planner.html', 'JDK.html', 'line-auth-client.js', 'job-ui-helpers.js'];
  for (const asset of assets) {
    const source = readRepoFile(asset);
    assert.doesNotMatch(source, /\bSUPABASE_ANON_KEY\b/, `${asset} should not reference SUPABASE_ANON_KEY`);
  }

  const authClient = readRepoFile('line-auth-client.js');
  assert.match(
    authClient,
    /createClient\s*\(\s*supabaseUrl,\s*supabasePublishableKey,\s*\{[\s\S]*accessToken:\s*async\s*\(\)\s*=>\s*fetchSupabaseToken\(/,
    'line-auth-client.js must require the authenticated access token callback'
  );
});

test('Preflight: RLS helpers and comment identity SQL enforce scoped authenticated ownership', () => {
  const foundation = readRepoFile('supabase', 'line-auth-foundation.sql');
  const orgScope = readRepoFile('supabase', 'line-auth-org-scope.sql');

  assert.match(orgScope, /required_org = public\.current_request_organization\(\)/);
  assert.match(foundation, /new\.actor_user_id := auth\.uid\(\);/);
  assert.match(foundation, /new\.author_name_snapshot := resolved_display_name;/);
  assert.match(foundation, /new\.author_picture_url_snapshot := resolved_picture_url;/);
  assert.match(
    foundation,
    /create policy "Authenticated insert comments by membership"[\s\S]*actor_user_id = auth\.uid\(\)[\s\S]*organization = public\.current_request_organization\(\)/s
  );
});

test('Preflight: Hisolar and JDK bootstraps verify auth before loading data or realtime', async () => {
  const hisolarCalls = await runHtmlBootstrap('hisolar_planner.html', { app: 'hisolar' });
  assert.ok(
    hisolarCalls.indexOf('fetchAuthMe:hisolar') < hisolarCalls.indexOf('loadData'),
    'hisolar bootstrap should authenticate before loadData'
  );
  assert.ok(
    hisolarCalls.indexOf('loadData') < hisolarCalls.indexOf('setupRealtime'),
    'hisolar bootstrap should load data before realtime'
  );

  const jdkCalls = await runHtmlBootstrap('JDK.html', { app: 'jdk' });
  assert.ok(
    jdkCalls.indexOf('fetchAuthMe:jdk') < jdkCalls.indexOf('loadData'),
    'JDK bootstrap should authenticate before loadData'
  );
  assert.ok(
    jdkCalls.indexOf('loadData') < jdkCalls.indexOf('setupRealtime'),
    'JDK bootstrap should load data before realtime'
  );

  const deniedCalls = await runHtmlBootstrap('JDK.html', {
    app: 'jdk',
    fetchAuthError: { status: 401, message: 'Authentication required' },
  });
  assert.ok(!deniedCalls.includes('loadData'));
  assert.ok(!deniedCalls.includes('setupRealtime'));
});

test('Preflight: JDK frontend exposes no status update path for jobs', () => {
  const source = readRepoFile('JDK.html');
  assert.doesNotMatch(source, /\.from\('hi_solar_jobs'\)\.update\(/);
  assert.doesNotMatch(source, /\.from\('hi_solar_jobs'\)\.insert\(/);
  assert.doesNotMatch(source, /openStatus/i);
  assert.doesNotMatch(source, /เปลี่ยนสถานะ/);

  const buildCardSnippet = extractFunctionSnippet(
    source,
    'function buildCard(tabKey, row) {',
    'function stripTime',
    'JDK buildCard'
  );
  const context = vm.createContext({
    escapeHtml: value => String(value || ''),
    statusClass: () => 'waiting',
    commentCount: () => 0,
    displayStatus: (_tabKey, status) => status,
    buildMapsActionButton: () => '',
    buildCallActionButton: () => '',
    buildPhoneMeta: () => '',
    commentSummaryHtml: () => '',
  });
  vm.runInContext(`${buildCardSnippet}; this.buildCard = buildCard;`, context, { filename: 'JDK.html' });
  const html = context.buildCard('ngan', {
    status: 'Waiting',
    customer: 'Customer',
    date: '2026-07-12',
    detail: '',
    _comments: [],
    _noteBase: '',
    note: '',
  });

  assert.match(html, /Comment/);
  assert.doesNotMatch(html, /btn-status|openStatus|updateStatus/i);
  assert.doesNotMatch(html, /เปลี่ยนสถานะ/);
});

test('Preflight: Maps sanitizer fallback is deny-by-default in both frontends', () => {
  for (const filename of ['hisolar_planner.html', 'JDK.html']) {
    const source = readRepoFile(filename);
    assert.match(source, /function sanitizeMapsUrlFallback\(value\)/, `${filename} must define a safe fallback`);
    assert.doesNotMatch(
      source,
      /function sanitizeMapsUrl\(value\)\s*\{[\s\S]*return String\(value \|\| ''\)\.trim\(\);/s,
      `${filename} must not fall back to raw maps_url`
    );
  }
});

test('Preflight: cutover migration drops every current anon policy and rollback restores the same set', () => {
  const legacySources = [
    readRepoFile('supabase', 'schema.sql'),
    readRepoFile('supabase', 'permit-module.sql'),
    readRepoFile('supabase', 'add-gcal-columns.sql'),
  ];
  const expectedPolicies = new Set();
  for (const source of legacySources) {
    for (const name of extractPolicyNames(source, 'create')) {
      if (name.startsWith('Public ')) expectedPolicies.add(name);
    }
  }

  const cutoverPolicies = extractPolicyNames(readRepoFile('supabase', 'line-auth-cutover.sql'), 'drop');
  const rollbackPolicies = extractPolicyNames(readRepoFile('supabase', 'line-auth-cutover-rollback.sql'), 'create');

  assert.deepEqual([...cutoverPolicies].sort(), [...expectedPolicies].sort());
  assert.deepEqual([...rollbackPolicies].sort(), [...expectedPolicies].sort());
});
