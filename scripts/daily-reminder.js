/**
 * Hi Solar — Daily LINE Reminder
 *
 * ดึง Google Calendar (iCal) → format → ส่ง LINE Messaging API
 *
 * GitHub Secrets ที่ต้องตั้ง:
 *   ICAL_URL           — iCal public URL ของ Google Calendar
 *   LINE_CHANNEL_TOKEN — Long-lived Channel Access Token
 *   LINE_GROUP_ID      — Group ID ของกลุ่ม LINE ทีมงาน
 */

// ── Config ────────────────────────────────────────────────────────────────────

const ICAL_URL          = process.env.ICAL_URL;
const LINE_TOKEN        = process.env.LINE_CHANNEL_TOKEN;
const LINE_GROUP_ID     = process.env.LINE_GROUP_ID;
const DATE_OVERRIDE     = process.env.DATE_OVERRIDE || '';  // YYYY-MM-DD
const FILTER_KEYWORD    = process.env.FILTER_KEYWORD || '';  // กรองเฉพาะ event ที่ชื่อมีคำนี้ เช่น "| JDK"

const LINE_API          = 'https://api.line.me/v2/bot/message/push';

const DAYS_TH   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                   'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTargetDate() {
  if (DATE_OVERRIDE && /^\d{4}-\d{2}-\d{2}$/.test(DATE_OVERRIDE)) {
    return new Date(DATE_OVERRIDE + 'T00:00:00+07:00');
  }
  // วันนี้ตาม Bangkok time
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return now;
}

function formatThaiDate(date) {
  const day   = DAYS_TH[date.getDay()];
  const d     = date.getDate();
  const month = MONTHS_TH[date.getMonth()];
  const year  = date.getFullYear() + 543;
  return `${day}ที่ ${d} ${month} ${year}`;
}

function toLocalDate(dtString) {
  /**
   * Parse iCal DTSTART / DTEND ทั้ง format:
   *   DTSTART;TZID=Asia/Bangkok:20260410T090000   → datetime
   *   DTSTART:20260410T000000Z                    → UTC datetime
   *   DTSTART;VALUE=DATE:20260410                 → all-day
   */
  if (!dtString) return null;

  // All-day: YYYYMMDD
  if (/^\d{8}$/.test(dtString)) {
    const y = dtString.slice(0,4), m = dtString.slice(4,6), d = dtString.slice(6,8);
    return new Date(`${y}-${m}-${d}T00:00:00+07:00`);
  }

  // Datetime UTC: YYYYMMDDTHHmmssZ
  if (dtString.endsWith('Z')) {
    return new Date(
      dtString.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        '$1-$2-$3T$4:$5:$6Z')
    );
  }

  // Datetime with TZID (assume Asia/Bangkok already)
  const m2 = dtString.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (m2) {
    return new Date(`${m2[1]}-${m2[2]}-${m2[3]}T${m2[4]}:${m2[5]}:${m2[6]}+07:00`);
  }

  return null;
}

function formatTime(date) {
  if (!date) return '';
  // แปลงเป็น Bangkok time ก่อน (GitHub Actions รันบน UTC)
  const bkk = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const h = String(bkk.getHours()).padStart(2,'0');
  const m = String(bkk.getMinutes()).padStart(2,'0');
  return `${h}:${m}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

// ── iCal Parser ───────────────────────────────────────────────────────────────

async function fetchIcal(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iCal fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

function parseIcal(text) {
  /**
   * Parse iCal text → array of event objects
   * รองรับ line folding (lines starting with space/tab = continuation)
   */
  const events = [];
  const lines  = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Unfold lines (RFC 5545: continuation lines start with space/tab)
  const unfolded = lines.replace(/\n[ \t]/g, '');

  let current = null;

  for (const raw of unfolded.split('\n')) {
    const line = raw.trim();

    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT' && current) {
      events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    // Parse key (with optional params) : value
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;

    const keyPart = line.slice(0, colonIdx);
    const value   = line.slice(colonIdx + 1);

    // Extract base key (before ;TZID= or ;VALUE= etc.)
    const baseKey = keyPart.split(';')[0].toUpperCase();

    switch (baseKey) {
      case 'SUMMARY':     current.summary     = value; break;
      case 'DESCRIPTION': current.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ','); break;
      case 'LOCATION':    current.location    = value; break;
      case 'DTSTART':     current.dtstart     = value; break;
      case 'DTEND':       current.dtend       = value; break;
      case 'STATUS':      current.status      = value; break;
      case 'UID':         current.uid         = value; break;
    }
  }

  return events;
}

function filterTodayEvents(events, targetDate) {
  return events
    .filter(ev => {
      if (ev.status === 'CANCELLED') return false;
      const start = toLocalDate(ev.dtstart);
      if (!start) return false;
      if (!isSameDay(start, targetDate)) return false;
      // กรองด้วย FILTER_KEYWORD ถ้าตั้งไว้
      if (FILTER_KEYWORD && !(ev.summary || '').includes(FILTER_KEYWORD)) return false;
      return true;
    })
    .map(ev => ({
      ...ev,
      startDate: toLocalDate(ev.dtstart),
      endDate:   toLocalDate(ev.dtend),
    }))
    .sort((a, b) => (a.startDate || 0) - (b.startDate || 0));
}

// ── Message Builder ───────────────────────────────────────────────────────────

function buildMessage(events, targetDate) {
  const dateLabel = formatThaiDate(targetDate);
  const isToday   = isSameDay(targetDate, new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })));
  const header    = isToday ? `☀️ Hi Solar — งานวันนี้` : `☀️ Hi Solar — งาน ${dateLabel}`;

  if (!events.length) {
    return `${header}\n${dateLabel}\n\n✅ ไม่มีงานในวันนี้`;
  }

  const lines = [header, dateLabel, ''];

  events.forEach((ev, i) => {
    const timeStr = ev.startDate && ev.startDate.getHours() !== 0
      ? `🕐 ${formatTime(ev.startDate)}  `
      : '';
    const summary = ev.summary || '(ไม่มีชื่อ)';

    lines.push(`${i + 1}. ${timeStr}${summary}`);

    if (ev.description) {
      const desc = ev.description.split('\n')[0].trim().slice(0, 60);
      if (desc) lines.push(`   📝 ${desc}`);
    }
    if (ev.location && ev.location.startsWith('http')) {
      lines.push(`   📍 ${ev.location}`);
    } else if (ev.location) {
      lines.push(`   📍 ${ev.location.slice(0, 50)}`);
    }
  });

  lines.push('');
  lines.push(`รวม ${events.length} งาน — Hi Solar Tracker: https://hi-solar-tracker.vercel.app`);

  return lines.join('\n');
}

// ── LINE Messaging API ────────────────────────────────────────────────────────

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
  // Validate env
  const missing = ['ICAL_URL', 'LINE_CHANNEL_TOKEN', 'LINE_GROUP_ID']
    .filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }

  const targetDate = getTargetDate();
  console.log(`Target date: ${targetDate.toISOString()} (${formatThaiDate(targetDate)})`);

  // 1. Fetch iCal
  console.log('Fetching iCal...');
  const icalText = await fetchIcal(ICAL_URL);
  console.log(`iCal size: ${icalText.length} chars`);

  // 2. Parse + filter today
  const allEvents   = parseIcal(icalText);
  const todayEvents = filterTodayEvents(allEvents, targetDate);
  console.log(`Total events: ${allEvents.length}, Today: ${todayEvents.length}`);

  // 3. Build message
  const message = buildMessage(todayEvents, targetDate);
  console.log('\n── Message Preview ──────────────────────────');
  console.log(message);
  console.log('─────────────────────────────────────────────\n');

  // 4. Send LINE
  await sendLine(LINE_GROUP_ID, LINE_TOKEN, message);
  console.log('Done ✅');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
