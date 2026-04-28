/**
 * POST /api/webhook/line-events
 *
 * Temporary endpoint สำหรับ capture LINE Group ID
 * 1. ตั้ง Webhook URL นี้ใน LINE Developers Console
 * 2. ส่งข้อความใดก็ได้ในกลุ่ม LINE ทีมงาน
 * 3. ดู Group ID ใน Vercel Function Logs
 */

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Verify LINE signature
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (channelSecret) {
    const signature = req.headers['x-line-signature'];
    const body      = JSON.stringify(req.body);
    const expected  = crypto
      .createHmac('sha256', channelSecret)
      .update(body)
      .digest('base64');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Log all events → ดูใน Vercel Functions Logs
  const events = req.body?.events || [];
  for (const event of events) {
    const source  = event.source || {};
    const type    = event.type;
    const userId  = source.userId  || '—';
    const groupId = source.groupId || '—';
    const roomId  = source.roomId  || '—';
    const text    = event.message?.text || '';

    console.log(JSON.stringify({
      event_type: type,
      source_type: source.type,
      userId,
      groupId,   // ← นี่คือค่าที่ต้องการ
      roomId,
      text,
    }));

    // Print ชัด ๆ ให้หาง่ายใน logs
    if (groupId !== '—') {
      console.log(`\n✅ GROUP ID พบแล้ว: ${groupId}\n`);
    }
  }

  // LINE ต้องการ 200 response
  return res.status(200).json({ ok: true });
}
