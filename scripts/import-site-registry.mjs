/**
 * Hi Solar Tracker — Site Registry importer (Sprint 1)
 * ---------------------------------------------------------------------------
 * Loads the unified 271-site registry into public.hi_solar_sites.
 * Source of truth: Solar_Site_DATA/_reference/sites_seed.csv
 *   (generated from the vendor exports via the build step).
 *
 * Idempotent: upserts on (platform_code, platform_plant_id), so re-running
 * updates existing sites instead of duplicating them.
 *
 * Env (same names as scripts/daily-reminder.js):
 *   SUPABASE_URL               required
 *   SUPABASE_SERVICE_ROLE_KEY  required to write (bypasses RLS for the load;
 *                              hi_solar_sites has no anon insert/update policy)
 *   SUPABASE_ANON_KEY          only enough for --dry-run parsing checks
 *
 * Usage:
 *   node scripts/import-site-registry.mjs            # dry-run: parse + preview
 *   node scripts/import-site-registry.mjs --commit   # actually upsert
 *   node scripts/import-site-registry.mjs --commit --file path/to.csv
 *
 * Run supabase/site-registry.sql first to create the tables.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const fileArg = args[args.indexOf('--file') + 1];
const CSV_PATH = fileArg && fileArg !== '--commit'
  ? resolve(fileArg)
  : resolve(__dirname, '../Solar_Site_DATA/_reference/sites_seed.csv');

const NUMERIC = new Set(['capacity_kwp', 'current_power_kw', 'yield_today_kwh', 'total_yield_kwh']);
const DATE = new Set(['grid_connection_date']);

// --- minimal RFC-4180 CSV parser (handles quotes, commas, newlines) ---------
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

function toDate(v) {
  const m = String(v).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
function toNum(v) {
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function loadRows() {
  const raw = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(raw).filter(r => r.length > 1 && r.some(c => c !== ''));
  const header = rows.shift().map(h => h.trim());
  return rows.map(cols => {
    const rec = {};
    header.forEach((h, i) => {
      let v = (cols[i] ?? '').trim();
      if (v === '') { rec[h] = null; return; }
      if (NUMERIC.has(h)) rec[h] = toNum(v);
      else if (DATE.has(h)) rec[h] = toDate(v);
      else rec[h] = v;
    });
    rec.organization = 'hisolar';
    rec.synced_at = new Date().toISOString();
    return rec;
  });
}

async function main() {
  const records = loadRows();
  const byPlatform = records.reduce((a, r) => (a[r.platform_code] = (a[r.platform_code] || 0) + 1, a), {});
  const totalKwp = records.reduce((s, r) => s + (r.capacity_kwp || 0), 0);

  console.log(`Source : ${CSV_PATH}`);
  console.log(`Parsed : ${records.length} sites  |  ${totalKwp.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWp`);
  console.log('By platform:', byPlatform);
  console.log('Sample:', JSON.stringify(records[0], null, 1));

  if (!COMMIT) {
    console.log('\n[dry-run] nothing written. Re-run with --commit to upsert.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const CHUNK = 100;
  let done = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = records.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('hi_solar_sites')
      .upsert(batch, { onConflict: 'platform_code,platform_plant_id' });
    if (error) throw new Error(`upsert failed at row ${i}: ${error.message}`);
    done += batch.length;
    console.log(`  upserted ${done}/${records.length}`);
  }
  console.log(`\nDone. ${done} sites in hi_solar_sites.`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
