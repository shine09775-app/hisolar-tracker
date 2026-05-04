/**
 * Hi Solar — Daily LINE Reminder (Supabase version)
 *
 * ดึงงานจาก Supabase ที่วันนี้อยู่ในช่วง วันที่เริ่มงาน – วันที่สิ้นสุดงาน
 * แล้วส่งแจ้งเตือนไป LINE กลุ่ม
 *
 * GitHub Secrets ที่ต้องตั้ง:
 *   SUPABASE_URL        — https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY   — anon public key
 *   LINE_CHANNEL_TOKEN  — Long-lived Channel Access Token
 *   LINE_GROUP_ID       — Group ID ของกลุ่ม LINE
 */

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_ANON_KEY;
const LINE_TOKEN     = process.env.LINE_CHANNEL_TOKEN;
const LINE_GROUP_ID  = process.env.LINE_GROUP_ID;
const DATE_OVERRIDE  = process.env.DATE_OVERRIDE || '';   // YYYY-MM-DD

const LINE_API = 'https://api.line.me/v2/bot/message/push';

const DAYS_TH   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                   'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayBangkok() {
  if (DATE_OVERRIDE && /^\d{4}-\d{2}-\d{2}$/.test(DATE_OVERRIDE)) return DATE_OVERRIDE;
  // Bangkok = UTC+7
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 10);
}

function formatThaiDate(dateStr) {
  // dateStr = YYYY-MM-DD
  const d = new Date(dateStr + 'T00:00:00Z');
  const day   = DAYS_TH[d.getUTCDay()];
  const date  = d.getUTCDate();
  const month = MONTHS_TH[d.getUTCMonth()];
  const year  = d.getUTCFullYear() + 543;
  return `${day}ที่ ${date} ${month} ${year}`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS_TH[d.getUTCMonth()]}`;
}

// ── Supabase Fetch ────────────────────────────────────────────────────────────

async function fetchTodayJobs(today) {
  /**
   * ดึงงานทั้งหมดที่มี วันที่เริ่มงาน/สิ้นสุดงาน แล้ว filter client-side
   * เพราะ JSONB text extraction ผ่าน PostgREST URL อาจมีปัญหา encoding
   */
  const url = `${SUPABASE_URL}/rest/v1/hi_solar_jobs?select=id,customer_name,detail,technician,maps_url,status,raw_data&order=synced_at.desc&limit=500`;

  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);

  const jobs = await res.json();

  // Filter: วันที่เริ่มงาน <= today <= วันที่สิ้นสุดงาน
  return jobs.filter(job => {
    const start = job.raw_data?.['วันที่เริ่มงาน'];
    const end   = job.raw_data?.['วันที่สิ้นสุดงาน'];
    if (!start || !end) return false;
    return start <= today && today <= end;
  });
}

// ── Message Builder ───────────────────────────────────────────────────────────

function buildMessage(jobs, today) {
  const dateLabel = formatThaiDate(today);
  const header    = `☀️ Hi Solar — งานวันนี้\n${dateLabel}`;

  if (!jobs.length) {
    return `${header}\n\n✅ ไม่มีงานในวันนี้`;
  }

  const lines = [header, ''];

  jobs.forEach((job, i) => {
    const name     = job.customer_name || '(ไม่ระบุลูกค้า)';
    const detail   = job.detail || job.raw_data?.['รายละเอียด'] || '';
    const tech     = job.technician || job.raw_data?.['ช่าง'] || '';
    const phone    = job.raw_data?.['เบอร์โทร'] || '';
    const maps     = job.maps_url || job.raw_data?.['Maps'] || '';
    const timeStr  = job.raw_data?.['เวลา'] || '';
    const start    = job.raw_data?.['วันที่เริ่มงาน'] || '';
    const end      = job.raw_data?.['วันที่สิ้นสุดงาน'] || '';

    // ช่วงวันที่
    const dateRange = start === end
      ? formatDateShort(start)
      : `${formatDateShort(start)} – ${formatDateShort(end)}`;

    lines.push(`${i + 1}. 🔧 ${name}`);
    if (timeStr) lines.push(`   🕐 ${timeStr}  📅 ${dateRange}`);
    else         lines.push(`   📅 ${dateRange}`);
    if (detail)  lines.push(`   📝 ${detail.slice(0, 80)}`);
    if (tech)    lines.push(`   👷 ${tech}`);
    if (phone)   lines.push(`   📞 ${phone}`);
    if (maps)    lines.push(`   📍 ${maps}`);
    lines.push('');
  });

  lines.push(`รวม ${jobs.length} งาน — Hi Solar Tracker: https://hi-solar-tracker.vercel.app`);
  return lines.join('\n');
}

// ── LINE Send ─────────────────────────────────────────────────────────────────

async function sendLine(groupId, token, text) {
  const res = await fetch(LINE_API, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: 'text', text }],
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`LINE API error ${res.status}: ${body}`);
  console.log('LINE sent OK:', body);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'LINE_CHANNEL_TOKEN', 'LINE_GROUP_ID']
    .filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

  const today = getTodayBangkok();
  console.log(`Target date: ${today} (${formatThaiDate(today)})`);

  console.log('Fetching jobs from Supabase...');
  const jobs = await fetchTodayJobs(today);
  console.log(`Jobs for today: ${jobs.length}`);

  const message = buildMessage(jobs, today);
  console.log('\n── Message Preview ──────────────────────────');
  console.log(message);
  console.log('─────────────────────────────────────────────\n');

  await sendLine(LINE_GROUP_ID, LINE_TOKEN, message);
  console.log('Done ✅');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
