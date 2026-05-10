// POST /api/webhook/sync-calendar
//
// Env vars required:
//   SYNC_CALENDAR_TOKEN       — secret in x-sync-token header
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY        — PEM key (newlines as \n or literal)
//   GOOGLE_CALENDAR_ID        — target calendar (e.g. "primary" or a calendar ID)

const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

const HI_SOLAR_ATTENDEES = [
  { email: 'shine09775@gmail.com' },
  { email: 'wassannukp@gmail.com' },
  { email: 'wave.0076.0076@gmail.com' },
  { email: 'kodungchank@gmail.com' },
];

const JDK_ATTENDEES = [
  { email: 'jessada.jdk@gmail.com' },
  { email: 'pitchanakan.jdk@gmail.com' },
  { email: 'pongphat09.jdk@gmail.com' },
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers['x-sync-token'];
  if (!token || token !== process.env.SYNC_CALENDAR_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const { type } = req.body || {};
  if (type !== 'hi_solar' && type !== 'jdk') {
    return res.status(400).json({ error: 'body.type must be "hi_solar" or "jdk"' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ── Query Supabase ────────────────────────────────────────────────────────
  let query = supabase
    .from('hi_solar_jobs')
    .select('id, sheet_key, customer_name, title, detail, phone, job_date, job_time, technician, job_type, price, maps_url, status, note')
    .is('gcal_event_id', null)
    .not('job_date', 'is', null)
    .order('job_date', { ascending: true })
    .order('job_time', { ascending: true, nullsFirst: false });

  if (type === 'hi_solar') {
    query = query
      .in('sheet_key', ['duNgan', 'ngan', 'langPaeng'])
      .neq('status', 'ยกเลิก');
  } else {
    query = query.eq('status', 'Assigned');
  }

  const { data: jobs, error: queryError } = await query;
  if (queryError) {
    console.error('[sync-calendar] Supabase query error:', queryError);
    return res.status(500).json({ error: 'Supabase query failed', detail: queryError.message });
  }

  if (!jobs || jobs.length === 0) {
    return res.status(200).json({ success: true, synced_count: 0, type });
  }

  // ── Google Calendar client ────────────────────────────────────────────────
  let calendar;
  try {
    calendar = buildCalendarClient();
  } catch (authErr) {
    console.error('[sync-calendar] Google auth error:', authErr);
    return res.status(500).json({ error: 'Google Calendar auth failed', detail: authErr.message });
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  // ── Sync each job ─────────────────────────────────────────────────────────
  let synced_count = 0;
  const errors = [];

  for (const job of jobs) {
    try {
      const event = buildEvent(job, type);

      const { data: created } = await calendar.events.insert({
        calendarId,
        requestBody: event,
        sendUpdates: 'all',
      });

      const { error: updateErr } = await supabase
        .from('hi_solar_jobs')
        .update({
          gcal_event_id: created.id,
          gcal_synced_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      if (updateErr) {
        console.error(`[sync-calendar] Supabase update failed for job ${job.id}:`, updateErr);
        errors.push({ job_id: job.id, step: 'supabase_update', error: updateErr.message });
      } else {
        synced_count++;
      }
    } catch (eventErr) {
      console.error(`[sync-calendar] GCal insert failed for job ${job.id}:`, eventErr.message);
      errors.push({ job_id: job.id, step: 'gcal_insert', error: eventErr.message });
    }
  }

  const response = { success: true, synced_count, type };
  if (errors.length > 0) response.errors = errors;
  return res.status(200).json(response);
};

// ─── Google Calendar auth ─────────────────────────────────────────────────────

function buildCalendarClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set');
  if (!rawKey) throw new Error('GOOGLE_PRIVATE_KEY is not set');

  // Vercel stores env vars as-is; literal \n must be converted to real newlines
  const privateKey = rawKey.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  return google.calendar({ version: 'v3', auth });
}

// ─── Event builder ────────────────────────────────────────────────────────────

function buildEvent(job, type) {
  const isHiSolar = type === 'hi_solar';
  return {
    summary: buildTitle(job, isHiSolar),
    description: buildDescription(job, isHiSolar),
    ...(job.maps_url ? { location: job.maps_url } : {}),
    ...buildTimeSlot(job),
    attendees: isHiSolar ? HI_SOLAR_ATTENDEES : JDK_ATTENDEES,
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 60 }],
    },
  };
}

function buildTitle(job, isHiSolar) {
  const jobType = job.job_type || 'งาน';
  const name = job.customer_name || '-';
  if (isHiSolar) {
    const price = job.price != null ? Number(job.price).toLocaleString('th-TH') : '?';
    return `🔧 ${jobType} — ${name} (${price}฿) | Hi Solar`;
  }
  return `🔧 ${jobType} — ${name} | JDK`;
}

function buildDescription(job, isHiSolar) {
  const lines = [];
  if (job.title)      lines.push(`📋 รายการ: ${job.title}`);
  if (job.detail)     lines.push(`📝 รายละเอียด: ${job.detail}`);
  if (job.phone)      lines.push(`📞 เบอร์โทร: ${job.phone}`);
  if (job.technician) lines.push(`👷 ช่าง: ${job.technician}`);
  if (isHiSolar && job.price != null) {
    lines.push(`💰 ราคา: ${Number(job.price).toLocaleString('th-TH')} ฿`);
  }
  if (job.note)       lines.push(`\n📌 หมายเหตุ: ${job.note}`);
  return lines.join('\n');
}

function buildTimeSlot(job) {
  if (!job.job_time) {
    return {
      start: { date: job.job_date },
      end:   { date: nextDateStr(job.job_date) },
    };
  }

  // job_time comes from Postgres as "HH:MM:SS"
  const [hh, mm] = job.job_time.split(':');
  const startHour = parseInt(hh, 10);
  const startMin  = parseInt(mm, 10);

  let endHour = startHour + 2; // 2-hour default duration
  let endDate = job.job_date;
  if (endHour >= 24) {
    endHour -= 24;
    endDate = nextDateStr(job.job_date);
  }

  const pad = (n) => String(n).padStart(2, '0');
  return {
    start: { dateTime: `${job.job_date}T${pad(startHour)}:${pad(startMin)}:00+07:00`, timeZone: 'Asia/Bangkok' },
    end:   { dateTime: `${endDate}T${pad(endHour)}:${pad(startMin)}:00+07:00`,        timeZone: 'Asia/Bangkok' },
  };
}

function nextDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+07:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
