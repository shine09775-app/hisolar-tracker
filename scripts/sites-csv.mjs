/**
 * Hi Solar Tracker — Site registry CSV round-trip
 * ---------------------------------------------------------------------------
 * Bulk-edit site contact details in a spreadsheet instead of tapping through
 * 271 records on a phone.
 *
 *   export : pull every site into a CSV, pre-filled with what is already stored
 *   import : read that CSV back and update only the cells that changed
 *
 * Keyed on site_code (HS-0158), not the vendor plant id, so sites created in
 * the field are editable too.
 *
 * Blank cell = leave the database value alone. To clear a field on purpose,
 * type a single dash (-).
 *
 * The importer never inserts and never touches columns outside EDITABLE, so a
 * malformed row can only affect the fields listed there.
 *
 * Env:
 *   SUPABASE_URL               default https://hlswbazcojsnfibirkzl.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  required (hi_solar_sites has no anon write policy)
 *                              read from .env.local when not already exported
 *
 * Usage:
 *   node scripts/sites-csv.mjs export                  # -> sites-edit.csv
 *   node scripts/sites-csv.mjs export --out path.csv
 *   node scripts/sites-csv.mjs import path.csv         # dry-run: show the diff
 *   node scripts/sites-csv.mjs import path.csv --commit
 *
 * The CSV holds customer names and phone numbers. Keep it out of git — the
 * default filename is already ignored.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Reference columns are exported for context but never written back.
const REFERENCE = ['site_code', 'site_name', 'address', 'capacity_kwp', 'brand_code', 'grid_connection_date'];
const EDITABLE = ['customer_name', 'phone', 'contact_person', 'contact_method', 'inverter_model', 'inverter_count', 'panel_count', 'clean_interval_months', 'maps_url', 'notes'];
const NUMERIC = new Set(['inverter_count', 'panel_count', 'clean_interval_months']);
const CLEAR_TOKEN = '-';

// maps_url is rendered into an href by the browser pages. This path writes with
// the service role and never sees their validation, so it enforces the same
// allowlist as job-ui-helpers.js rather than trusting the spreadsheet.
function sanitizeMapsUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const allowed = host === 'maps.app.goo.gl'
    || /^maps\.google\./.test(host)
    || (/^(www\.)?google\./.test(host) && path.startsWith('/maps'));
  if (!allowed) return null;
  url.username = '';
  url.password = '';
  return url.toString();
}

function loadEnv() {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const envPath = resolve(repoRoot, '.env.local');
  if ((!url || !key) && existsSync(envPath)) {
    // split on \r?\n: a trailing \r is a line terminator that `.` will not match
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim();
      if (m[1] === 'SUPABASE_URL' && !url) url = value;
      if (m[1] === 'SUPABASE_SERVICE_ROLE_KEY' && !key) key = value;
    }
  }
  url = url || 'https://hlswbazcojsnfibirkzl.supabase.co';
  if (!key) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY (export it or put it in .env.local)');
    process.exit(1);
  }
  return { url, key };
}

// --- CSV (RFC-4180 subset: quotes, commas, embedded newlines) ---------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function fetchAllSites(sb) {
  const cols = [...new Set(['id', ...REFERENCE, ...EDITABLE])].join(',');
  const all = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from('hi_solar_sites')
      .select(cols)
      .order('site_code')
      .range(from, from + page - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return all;
}

async function doExport(sb, outArg) {
  const sites = await fetchAllSites(sb);
  const header = [...REFERENCE, ...EDITABLE];
  const lines = [header.join(',')];
  for (const s of sites) lines.push(header.map(h => csvCell(s[h])).join(','));
  const out = outArg ? resolve(outArg) : resolve(repoRoot, 'Solar_Site_DATA/_reference/sites-edit.csv');
  // BOM so Excel opens Thai text in the right encoding
  writeFileSync(out, '﻿' + lines.join('\n') + '\n', 'utf8');

  const missing = EDITABLE.map(f => `${f}: ${sites.filter(s => s[f] == null || s[f] === '').length}`);
  console.log(`exported ${sites.length} sites -> ${out}`);
  console.log('blank cells per editable column:');
  console.log('  ' + missing.join('\n  '));
  console.log(`\nEdit the ${EDITABLE.length} editable columns, leave blanks to keep current values,`);
  console.log(`type "${CLEAR_TOKEN}" to clear a field, then:`);
  console.log(`  node scripts/sites-csv.mjs import ${outArg || 'Solar_Site_DATA/_reference/sites-edit.csv'}`);
}

async function doImport(sb, fileArg, commit) {
  if (!fileArg) { console.error('Usage: node scripts/sites-csv.mjs import <file.csv> [--commit]'); process.exit(1); }
  const text = readFileSync(resolve(fileArg), 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text).filter(r => r.some(c => String(c).trim() !== ''));
  const header = rows.shift().map(h => h.trim());

  if (!header.includes('site_code')) { console.error('CSV must include a site_code column'); process.exit(1); }
  const unknown = header.filter(h => h && !REFERENCE.includes(h) && !EDITABLE.includes(h));
  if (unknown.length) console.warn(`ignoring unrecognised column(s): ${unknown.join(', ')}`);

  const sites = await fetchAllSites(sb);
  const byCode = new Map(sites.filter(s => s.site_code).map(s => [String(s.site_code).trim(), s]));

  const updates = [];
  const problems = [];
  rows.forEach((cells, i) => {
    const row = {};
    header.forEach((h, idx) => { row[h] = (cells[idx] ?? '').trim(); });
    const code = row.site_code;
    if (!code) { problems.push(`row ${i + 2}: no site_code`); return; }
    const site = byCode.get(code);
    if (!site) { problems.push(`row ${i + 2}: site_code ${code} not found`); return; }

    const patch = {};
    for (const f of EDITABLE) {
      if (!(f in row)) continue;
      const raw = row[f];
      if (raw === '') continue;                       // blank: keep what is stored
      let next = raw === CLEAR_TOKEN ? null : raw;
      if (next !== null && NUMERIC.has(f)) {
        const n = Number(next);
        if (!Number.isFinite(n)) { problems.push(`row ${i + 2}: ${f}="${raw}" is not a number`); continue; }
        next = n;
      }
      if (next !== null && f === 'maps_url') {
        const safe = sanitizeMapsUrl(next);
        if (!safe) { problems.push(`row ${i + 2}: maps_url must be an https Google Maps or maps.app.goo.gl link`); continue; }
        next = safe;
      }
      const before = site[f] == null ? null : site[f];
      if (String(before ?? '') === String(next ?? '')) continue;   // unchanged
      patch[f] = next;
    }
    if (Object.keys(patch).length) updates.push({ id: site.id, code, name: site.site_name, patch });
  });

  if (problems.length) {
    console.log(`\n${problems.length} row problem(s):`);
    for (const p of problems.slice(0, 20)) console.log('  - ' + p);
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
  }

  if (!updates.length) { console.log('\nnothing to update.'); return; }
  console.log(`\n${updates.length} site(s) would change:`);
  for (const u of updates.slice(0, 30)) {
    const fields = Object.entries(u.patch).map(([k, v]) => `${k}=${v === null ? '(clear)' : v}`).join(', ');
    console.log(`  ${u.code} ${u.name}: ${fields}`);
  }
  if (updates.length > 30) console.log(`  ... and ${updates.length - 30} more`);

  if (!commit) { console.log('\ndry-run. re-run with --commit to write.'); return; }

  let ok = 0;
  for (const u of updates) {
    const { error } = await sb.from('hi_solar_sites').update(u.patch).eq('id', u.id);
    if (error) { console.error(`  failed ${u.code}: ${error.message}`); continue; }
    ok++;
  }
  console.log(`\nupdated ${ok}/${updates.length} site(s).`);
}

const [mode, ...rest] = process.argv.slice(2);
const commit = rest.includes('--commit');
const outIdx = rest.indexOf('--out');
const { url, key } = loadEnv();
const sb = createClient(url, key, { auth: { persistSession: false } });

try {
  if (mode === 'export') await doExport(sb, outIdx >= 0 ? rest[outIdx + 1] : null);
  else if (mode === 'import') await doImport(sb, rest.find(a => !a.startsWith('--')), commit);
  else { console.error('Usage: node scripts/sites-csv.mjs <export|import> [...]'); process.exit(1); }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
