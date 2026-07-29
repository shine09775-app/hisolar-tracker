-- Hi Solar Tracker
-- Site registry cutover (ส่วนขยายของ line-auth-cutover.sql)
--
-- ทำไมต้องมีไฟล์นี้:
-- `line-auth-cutover.sql` เขียนไว้ก่อนที่ site registry จะเกิด จึงปิดเฉพาะ 5 ตารางเดิม
-- ตาราง site registry ยังมี policy `Public read` ที่ผูกกับ role `public`
-- (`public` ครอบคลุม anon ด้วย) ทำให้หลัง cutover ยังอ่านข้อมูลไซต์ได้ด้วย anon key
-- ทั้งที่ `hi_solar_sites` เก็บ PII มากกว่าตารางเดิม (ชื่อลูกค้า ที่อยู่ เบอร์โทร พิกัด)
--
-- ต้องรัน "คู่กับ" line-auth-cutover.sql ในหน้าต่าง cutover เดียวกัน

-- 1) hi_solar_sites
-- ปลอดภัยที่จะ drop ได้เลย เพราะมี policy authenticated ครอบอยู่แล้ว:
--   - "Authenticated read sites by org"  (organization = current_request_organization())
--   - "Authenticated write sites hisolar admin member"
drop policy if exists "Public read sites" on public.hi_solar_sites;

-- 2) dimension tables (hi_solar_inverter_brands / hi_solar_platforms)
-- ไม่มี PII (5 ยี่ห้อ / 6 แพลตฟอร์ม) และ browser ไม่ได้เรียกตรง แต่ปิด anon
-- ให้สอดคล้องกัน แล้วเปิดให้ authenticated อ่านเผื่อ UI ในอนาคต
drop policy if exists "Authenticated read brands" on public.hi_solar_inverter_brands;
create policy "Authenticated read brands"
on public.hi_solar_inverter_brands
for select
to authenticated
using (true);

drop policy if exists "Public read brands" on public.hi_solar_inverter_brands;

drop policy if exists "Authenticated read platforms" on public.hi_solar_platforms;
create policy "Authenticated read platforms"
on public.hi_solar_platforms
for select
to authenticated
using (true);

drop policy if exists "Public read platforms" on public.hi_solar_platforms;

-- 3) line_group_daily_replies — ปิดช่องโหว่ที่ security advisor เตือน (ERROR)
-- ตารางนี้เขียนโดย webhook ที่ใช้ service-role เท่านั้น ซึ่ง bypass RLS อยู่แล้ว
-- การเปิด RLS โดยไม่มี policy = ปิด anon สนิท และ service-role ยังทำงานได้ปกติ
alter table public.line_group_daily_replies enable row level security;
