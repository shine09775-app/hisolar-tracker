const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const browserExtensions = new Set(['.html', '.js']);
const excludedRoots = new Set([
  '.git',
  '.vercel',
  'api',
  'docs\\legacy',
  'node_modules',
  'scripts',
  'supabase',
  'tests',
]);

function shouldSkip(relativePath) {
  const normalized = relativePath.split(path.sep).join('\\');
  for (const excludedRoot of excludedRoots) {
    if (normalized === excludedRoot || normalized.startsWith(`${excludedRoot}\\`)) {
      return true;
    }
  }
  return false;
}

function collectBrowserAssets(currentDir, results = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(repoRoot, absolutePath);
    if (shouldSkip(relativePath)) continue;

    if (entry.isDirectory()) {
      collectBrowserAssets(absolutePath, results);
      continue;
    }

    if (browserExtensions.has(path.extname(entry.name))) {
      results.push(absolutePath);
    }
  }

  return results;
}

test('Deployable browser assets do not reference anon Supabase keys', () => {
  const browserAssets = collectBrowserAssets(repoRoot);
  assert.ok(browserAssets.length > 0, 'Expected to find deployable browser assets to scan');

  for (const absolutePath of browserAssets) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const relativePath = path.relative(repoRoot, absolutePath);
    assert.doesNotMatch(
      source,
      /\bSUPABASE_ANON_KEY\b/,
      `${relativePath} still references SUPABASE_ANON_KEY`
    );
    assert.doesNotMatch(
      source,
      /createClient\s*\(\s*[^,]+,\s*[^,)\n]*anon[^,)\n]*/i,
      `${relativePath} still appears to initialize a browser Supabase client with an anon fallback`
    );
  }
});

test('Only the shared auth client initializes the browser Supabase client', () => {
  const browserAssets = collectBrowserAssets(repoRoot);
  const createClientCallers = [];

  for (const absolutePath of browserAssets) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    if (/createClient\s*\(/.test(source)) {
      createClientCallers.push(path.relative(repoRoot, absolutePath));
    }
  }

  assert.deepEqual(createClientCallers, ['line-auth-client.js']);

  const authClientSource = fs.readFileSync(path.join(repoRoot, 'line-auth-client.js'), 'utf8');
  assert.match(
    authClientSource,
    /createClient\s*\(\s*supabaseUrl,\s*supabasePublishableKey,\s*\{[\s\S]*accessToken:\s*async\s*\(\)\s*=>\s*fetchSupabaseToken\(/,
    'line-auth-client.js must keep the authenticated accessToken callback'
  );
});
