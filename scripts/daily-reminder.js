/**
 * Hi Solar — Daily LINE Reminder (Supabase version)
 *
 * ดึงงานจาก Supabase ของทุกกลุ่ม (งาน / ดูงาน / ล้างแผง / ซ่อม)
 * ที่ "วันนี้" ตรงกับเงื่อนไขของแต่ละกลุ่ม แล้วส่งแจ้งเตือนไป LINE กลุ่มเดียว
 * เป็นข้อความเดียว — กลุ่มไหนไม่มีงานจะข้ามหัวข้อนั้นไป
 *
 *   🔧 งาน         — status = Assigned   และวันนี้อยู่ในช่วงวันที่เริ่มงาน–วันที่สิ้นสุดงาน
 *   📍 ดูงาน       — status = รอนัดหมาย  และวันที่นัด (job_date) = วันนี้
 *   💧 ล้างแผง     — status = นัดแล้ว    และวันที่ดำเนินการ (appointment_date) = วันนี้
 *   🔩 ซ่อม        — status = Assigned   และวันนี้อยู่ในช่วงวันที่เริ่มงาน–วันที่สิ้นสุดงาน
 *   📋 ขออนุญาติ   — status NOT IN (DONE, REJECTED) จาก hi_solar_permits
 *
 * GitHub Secrets ที่ต้องตั้ง:
 *   SUPABASE_URL                — https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — service_role key (แนะนำ; จำเป็นหลัง cutover ที่ลบ anon policies)
 *   SUPABASE_ANON_KEY           — anon public key (fallback; ใช้ได้เฉพาะก่อน cutover)
 *   LINE_CHANNEL_TOKEN          — Long-lived Channel Access Token
 *   LINE_GROUP_ID               — Group ID ของกลุ่ม LINE
 *
 * (ไม่บังคับ) เพิ่มแจ้งเตือนทาง Telegram — ตั้งครบ 2 ตัวจึงจะส่ง:
 *   TELEGRAM_BOT_TOKEN  — token จาก @BotFather
 *   TELEGRAM_CHAT_ID    — chat id ปลายทาง (ส่วนตัว หรือ group id)
 */

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.SUPABASE_URL;
// Prefer service_role (bypasses RLS) so the reminder keeps working after the
// LINE-auth cutover removes the legacy anon read policies. Falls back to the
// anon key while both keys are available (pre-cutover).
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const LINE_TOKEN     = process.env.LINE_CHANNEL_TOKEN;
const LINE_GROUP_ID  = process.env.LINE_GROUP_ID;
const DATE_OVERRIDE  = process.env.DATE_OVERRIDE || '';   // YYYY-MM-DD

// Telegram (ไม่บังคับ) — ตั้งครบทั้งคู่จึงจะส่ง
const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT        = process.env.TELEGRAM_CHAT_ID   || '';

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

function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  return String(timeStr).slice(0, 5);
}

// ── Supabase Fetch ────────────────────────────────────────────────────────────

async function fetchJobs() {
  const url = `${SUPABASE_URL}/rest/v1/hi_solar_jobs`
    + `?select=id,sheet_key,customer_name,title,detail,phone,job_date,job_time,appointment_date,technician,maps_url,status,raw_data`
    + `&order=synced_at.desc&limit=1000`;

  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);

  return res.json();
}

async function fetchActivePermits() {
  // ดึงใบขออนุญาติที่ยังไม่เสร็จ (ยกเว้น DONE และ REJECTED)
  const url = `${SUPABASE_URL}/rest/v1/hi_solar_permits`
    + `?select=id,customer_name,site_name,utility_provider,meter_phase,pv_kwp,status,phase`
    + `&status=not.in.(DONE,REJECTED)`
    + `&order=created_at.asc&limit=200`;

  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) throw new Error(`Supabase fetch permits failed: ${res.status} ${await res.text()}`);

  return res.json();
}

// ── Grouping ──────────────────────────────────────────────────────────────────

function groupJobsForToday(jobs, today) {
  const groups = { ngan: [], duNgan: [], langPaeng: [], som: [] };

  jobs.forEach(job => {
    const raw = job.raw_data || {};

    if (job.sheet_key === 'ngan' || job.sheet_key === 'som') {
      if (job.status !== 'Assigned') return;
      const start = raw['วันที่เริ่มงาน'];
      const end   = raw['วันที่สิ้นสุดงาน'];
      if (!start || !end) return;
      if (start <= today && today <= end) groups[job.sheet_key].push(job);
      return;
    }

    if (job.sheet_key === 'duNgan') {
      if (job.status !== 'รอนัดหมาย') return;
      if (job.job_date === today) groups.duNgan.push(job);
      return;
    }

    if (job.sheet_key === 'langPaeng') {
      if (job.status !== 'นัดแล้ว') return;
      if (job.appointment_date === today) groups.langPaeng.push(job);
      return;
    }
  });

  return groups;
}

// ── Section Builders ─────────────────────────────────────────────────────────

function buildNganLines(jobs) {
  const lines = [`🔧 งาน (${jobs.length})`, ''];

  jobs.forEach((job, i) => {
    const raw    = job.raw_data || {};
    const name   = job.customer_name || raw['ลูกค้า'] || '(ไม่ระบุลูกค้า)';
    const detail = job.detail || raw['รายละเอียด'] || '';
    const tech   = job.technician || raw['ช่าง'] || '';
    const phone  = job.phone || raw['เบอร์โทร'] || '';
    const maps   = job.maps_url || raw['Maps'] || '';
    const start  = raw['วันที่เริ่มงาน'] || '';
    const end    = raw['วันที่สิ้นสุดงาน'] || '';
    const dateRange = start === end
      ? formatDateShort(start)
      : `${formatDateShort(start)} – ${formatDateShort(end)}`;

    lines.push(`${i + 1}. ${name}`);
    lines.push(`   📅 ${dateRange}`);
    if (detail) lines.push(`   📝 ${detail.slice(0, 80)}`);
    if (tech)   lines.push(`   👷 ${tech}`);
    if (phone)  lines.push(`   📞 ${phone}`);
    if (maps)   lines.push(`   📍 ${maps}`);
    lines.push('');
  });

  return lines;
}

function buildDuNganLines(jobs) {
  const lines = [`📍 ดูงาน (${jobs.length})`, ''];

  jobs.forEach((job, i) => {
    const raw   = job.raw_data || {};
    const name  = job.customer_name || raw['ลูกค้า'] || '(ไม่ระบุลูกค้า)';
    const phone = job.phone || raw['เบอร์โทร'] || '';
    const maps  = job.maps_url || raw['Maps'] || '';
    const time  = formatTimeShort(job.job_time) || raw['เวลา'] || '';
    const note  = job.raw_data?.['หมายเหตุ'] || '';

    lines.push(`${i + 1}. ${name}`);
    if (time)  lines.push(`   🕐 ${time} น.`);
    if (phone) lines.push(`   📞 ${phone}`);
    if (maps)  lines.push(`   📍 ${maps}`);
    if (note)  lines.push(`   📝 ${note.slice(0, 80)}`);
    lines.push('');
  });

  return lines;
}

function buildLangPaengLines(jobs) {
  const lines = [`💧 ล้างแผง (${jobs.length})`, ''];

  jobs.forEach((job, i) => {
    const raw   = job.raw_data || {};
    const name  = job.customer_name || raw['ลูกค้า'] || '(ไม่ระบุลูกค้า)';
    const phone = job.phone || raw['เบอร์โทร'] || '';
    const maps  = job.maps_url || raw['Maps'] || '';
    const tech  = job.technician || raw['ช่าง'] || '';
    const time  = formatTimeShort(job.job_time) || raw['เวลานัด'] || '';

    lines.push(`${i + 1}. ${name}`);
    if (time)  lines.push(`   🕐 ${time} น.`);
    if (tech)  lines.push(`   👷 ${tech}`);
    if (phone) lines.push(`   📞 ${phone}`);
    if (maps)  lines.push(`   📍 ${maps}`);
    lines.push('');
  });

  return lines;
}

function buildSomLines(jobs) {
  const lines = [`🔩 ซ่อม (${jobs.length})`, ''];

  jobs.forEach((job, i) => {
    const raw      = job.raw_data || {};
    const name     = job.title || raw['รายการ'] || job.customer_name || raw['ลูกค้า'] || '(ไม่ระบุรายการ)';
    const customer = job.customer_name || raw['ลูกค้า'] || '';
    const phone    = job.phone || raw['เบอร์โทร'] || '';
    const maps     = job.maps_url || raw['Maps'] || '';
    const tech     = job.technician || raw['ช่าง'] || '';
    const start    = raw['วันที่เริ่มงาน'] || '';
    const end      = raw['วันที่สิ้นสุดงาน'] || '';
    const dateRange = start === end
      ? formatDateShort(start)
      : `${formatDateShort(start)} – ${formatDateShort(end)}`;

    lines.push(`${i + 1}. ${name}`);
    if (customer && customer !== name) lines.push(`   👤 ${customer}`);
    lines.push(`   📅 ${dateRange}`);
    if (tech)  lines.push(`   👷 ${tech}`);
    if (phone) lines.push(`   📞 ${phone}`);
    if (maps)  lines.push(`   📍 ${maps}`);
    lines.push('');
  });

  return lines;
}

const PHASE_LABEL = {
  PRECHECK:   'เตรียมเอกสาร',
  DOCS:       'ส่งเอกสาร',
  SUBMITTED:  'ยื่นเอกสาร',
  COMMENT:    'รับคำแนะนำ/แก้ไข',
  CONTRACT:   'ชำระเงิน',
  INSPECTION: 'นัดตรวจ',
  APPROVED:   'อนุมัติ',
  CLOSED:     'ออกเอกสารขนานไฟฟ้า',
};

function buildPermitLines(permits) {
  const lines = [`📋 ขออนุญาติ (${permits.length} งาน)`, ''];

  permits.forEach((p, i) => {
    const name    = p.customer_name || '(ไม่ระบุลูกค้า)';
    const site    = p.site_name     || '';
    const phase   = PHASE_LABEL[p.phase] || p.phase || '';
    const meter   = p.meter_phase === '3P' ? '3 เฟส' : p.meter_phase === '1P' ? '1 เฟส' : (p.meter_phase || '');
    const kwp     = p.pv_kwp != null ? `${p.pv_kwp} kWp` : '';

    lines.push(`${i + 1}. ${name}`);
    if (site)  lines.push(`   📌 ${site}`);
    const specs = [meter, kwp].filter(Boolean).join(' | ');
    if (specs) lines.push(`   ⚡ ${specs}`);
    if (phase) lines.push(`   🔄 ${phase}`);
    lines.push('');
  });

  return lines;
}

// ── Message Builder ───────────────────────────────────────────────────────────

function buildMessage(groups, permits, today) {
  const dateLabel = formatThaiDate(today);
  const header    = `☀️ Hi Solar — งานวันนี้\n${dateLabel}`;

  const sections = [
    { items: groups.ngan,      build: buildNganLines },
    { items: groups.duNgan,    build: buildDuNganLines },
    { items: groups.langPaeng, build: buildLangPaengLines },
    { items: groups.som,       build: buildSomLines },
    { items: permits,          build: buildPermitLines },
  ].filter(s => s.items.length > 0);

  if (!sections.length) {
    return `${header}\n\n✅ ไม่มีงานในวันนี้`;
  }

  const lines = [header, ''];
  sections.forEach(s => lines.push(...s.build(s.items)));

  const jobCount    = groups.ngan.length + groups.duNgan.length + groups.langPaeng.length + groups.som.length;
  const permitCount = permits.length;
  const parts = [];
  if (jobCount)    parts.push(`${jobCount} งาน`);
  if (permitCount) parts.push(`ขออนุญาติ ${permitCount} งาน`);
  lines.push(`รวม ${parts.join(' | ')} — Hi Solar Tracker: https://hi-solar-tracker.vercel.app`);
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

// ── Telegram Send ───────────────────────────────────────────────────────────────

// Telegram จำกัด 4096 ตัวอักษร/ข้อความ — แบ่งเป็นก้อนตามบรรทัดให้ไม่เกิน limit
function splitForTelegram(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur ? cur.length + 1 : 0) + line.length > limit) {
      if (cur) chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function sendTelegram(chatId, token, text) {
  const API = `https://api.telegram.org/bot${token}/sendMessage`;
  for (const chunk of splitForTelegram(text)) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
  console.log('Telegram sent OK');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const missing = ['SUPABASE_URL', 'LINE_CHANNEL_TOKEN', 'LINE_GROUP_ID']
    .filter(k => !process.env[k]);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
  }
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

  const today = getTodayBangkok();
  console.log(`Target date: ${today} (${formatThaiDate(today)})`);

  console.log('Fetching jobs from Supabase...');
  const [jobs, permits] = await Promise.all([fetchJobs(), fetchActivePermits()]);
  const groups = groupJobsForToday(jobs, today);
  console.log(`Jobs for today: งาน=${groups.ngan.length} ดูงาน=${groups.duNgan.length} ล้างแผง=${groups.langPaeng.length} ซ่อม=${groups.som.length}`);
  console.log(`Permits pending: ${permits.length}`);

  const message = buildMessage(groups, permits, today);
  console.log('\n── Message Preview ──────────────────────────');
  console.log(message);
  console.log('─────────────────────────────────────────────\n');

  // ช่องทางหลัก: LINE (พฤติกรรมเดิม — ถ้าล้มถือว่า error)
  await sendLine(LINE_GROUP_ID, LINE_TOKEN, message);

  // ช่องทางเสริม: Telegram (ถ้าตั้งค่าไว้) — ไม่ให้ error ของ Telegram ทำให้ job ล้ม
  if (TG_TOKEN && TG_CHAT) {
    try {
      await sendTelegram(TG_CHAT, TG_TOKEN, message);
    } catch (err) {
      console.error('Telegram send failed (ignored):', err.message);
    }
  } else {
    console.log('Telegram not configured — skipped.');
  }

  console.log('Done ✅');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
