// POST /api/webhook/line-jdk-group
//
// Env vars required:
//   LINE_JDK_CHANNEL_SECRET       — for HMAC-SHA256 signature verify
//   LINE_JDK_CHANNEL_ACCESS_TOKEN — for reply API
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

// Bangkok time window: 06:00–12:00
const WINDOW_START_HOUR = 6;
const WINDOW_END_HOUR = 12;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ── Verify LINE signature ─────────────────────────────────────────────────
  const signature = req.headers['x-line-signature'];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const events = req.body?.events || [];

  for (const event of events) {
    // Only handle message events from groups
    if (event.type !== 'message' || event.source?.type !== 'group') continue;

    const replyToken = event.replyToken;
    const groupId = event.source.groupId;
    if (!replyToken || !groupId) continue;

    // ── Bangkok time window check: 06:00–12:00 ────────────────────────────
    if (!isInTimeWindow()) continue;

    const todayBKK = getTodayBKK();

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── Check if already replied today ────────────────────────────────────
    const { data: existing } = await supabase
      .from('line_group_daily_replies')
      .select('group_id')
      .eq('group_id', groupId)
      .eq('reply_date', todayBKK)
      .maybeSingle();

    if (existing) continue; // already sent today

    // ── Query today's JDK jobs ────────────────────────────────────────────
    const { data: jobs, error: queryError } = await supabase
      .from('hi_solar_jobs')
      .select('customer_name, job_time, technician, job_type, detail, phone, maps_url')
      .eq('job_date', todayBKK)
      .eq('status', 'Assigned')
      .order('job_time', { ascending: true, nullsFirst: false })
      .order('job_type', { ascending: true });

    if (queryError) {
      console.error('[line-jdk-group] Supabase query error:', queryError.message);
      continue;
    }

    // No jobs today → do nothing, don't consume the slot
    if (!jobs || jobs.length === 0) continue;

    // ── Format message ────────────────────────────────────────────────────
    const text = formatDailySummary(jobs, todayBKK);

    // ── Reply via LINE ────────────────────────────────────────────────────
    const replied = await sendReply(replyToken, text);
    if (!replied) continue;

    // ── Mark as replied (only after successful reply) ─────────────────────
    const { error: insertError } = await supabase
      .from('line_group_daily_replies')
      .insert({ group_id: groupId, reply_date: todayBKK });

    if (insertError && insertError.code !== '23505') {
      // 23505 = unique violation (race condition — another request replied first, acceptable)
      console.error('[line-jdk-group] Insert error:', insertError.message);
    }

    break; // processed one event → done
  }

  return res.status(200).json({ ok: true });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function verifySignature(body, signature) {
  const secret = process.env.LINE_JDK_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', secret).update(bodyStr).digest('base64');
  return hmac === signature;
}

function getTodayBKK() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  // → "2026-06-09"
}

function isInTimeWindow() {
  const hour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }),
    10
  );
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

function formatDailySummary(jobs, dateStr) {
  const dateLabel = formatThaiDate(dateStr);

  const installJobs = jobs.filter(j => j.job_type !== 'ซ่อม' && j.job_type !== 'repair');
  const repairJobs  = jobs.filter(j => j.job_type === 'ซ่อม' || j.job_type === 'repair');

  const lines = [`☀️ Hi Solar — แผนงานวันนี้`, dateLabel, ''];

  let counter = 1;

  if (installJobs.length > 0) {
    lines.push('🔧 งานติดตั้ง');
    for (const job of installJobs) {
      lines.push(...formatJobBlock(job, counter++));
    }
  }

  if (repairJobs.length > 0) {
    lines.push('🔨 งานซ่อม');
    for (const job of repairJobs) {
      lines.push(...formatJobBlock(job, counter++));
    }
  }

  lines.push(`รวม ${jobs.length} งาน`);
  return lines.join('\n');
}

function formatJobBlock(job, index) {
  const block = [`${index}. ${job.customer_name || '-'}`];
  const meta = [];
  if (job.job_time) meta.push(`🕐 ${job.job_time.slice(0, 5)}`);
  if (job.technician) meta.push(`👷 ${job.technician}`);
  if (meta.length > 0) block.push(`   ${meta.join(' | ')}`);
  if (job.detail) block.push(`   📝 ${job.detail}`);
  if (job.phone) block.push(`   📞 ${job.phone}`);
  if (job.maps_url) block.push(`   📍 ${job.maps_url}`);
  block.push('');
  return block;
}

function formatThaiDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00+07:00');
  const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const dayName = days[date.getDay()];
  const d = date.getDate();
  const m = months[date.getMonth()];
  const y = date.getFullYear() + 543;
  return `${dayName}ที่ ${d} ${m} ${y}`;
}

async function sendReply(replyToken, text) {
  try {
    const res = await fetch(LINE_REPLY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_JDK_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[line-jdk-group] LINE reply failed:', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[line-jdk-group] LINE reply error:', err.message);
    return false;
  }
}
