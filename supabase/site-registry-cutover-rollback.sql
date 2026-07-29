-- Hi Solar Tracker
-- Rollback ของ site-registry-cutover.sql
-- ใช้คู่กับ line-auth-cutover-rollback.sql เมื่อจำเป็นต้องคืนสถานะก่อน cutover
-- ⚠️ การคืน policy `Public read` = เปิดให้ anon key อ่านข้อมูลไซต์ (PII) ได้อีกครั้ง

drop policy if exists "Public read sites" on public.hi_solar_sites;
create policy "Public read sites"
on public.hi_solar_sites
for select
to public
using (true);

drop policy if exists "Public read brands" on public.hi_solar_inverter_brands;
create policy "Public read brands"
on public.hi_solar_inverter_brands
for select
to public
using (true);

drop policy if exists "Authenticated read brands" on public.hi_solar_inverter_brands;

drop policy if exists "Public read platforms" on public.hi_solar_platforms;
create policy "Public read platforms"
on public.hi_solar_platforms
for select
to public
using (true);

drop policy if exists "Authenticated read platforms" on public.hi_solar_platforms;

-- คืนสถานะ RLS ของ line_group_daily_replies (เดิมปิดอยู่)
alter table public.line_group_daily_replies disable row level security;
