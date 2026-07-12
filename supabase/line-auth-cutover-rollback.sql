-- Hi Solar Tracker
-- Temporary rollback for LINE auth cutover
-- Recreates legacy anon policies while incident response is in progress.

drop policy if exists "Public read jobs" on public.hi_solar_jobs;
create policy "Public read jobs"
on public.hi_solar_jobs
for select
to anon
using (true);

drop policy if exists "Public insert jobs" on public.hi_solar_jobs;
create policy "Public insert jobs"
on public.hi_solar_jobs
for insert
to anon
with check (
  sheet_key in ('ngan', 'duNgan', 'langPaeng', 'som', 'bil')
);

drop policy if exists "Public update jobs" on public.hi_solar_jobs;
create policy "Public update jobs"
on public.hi_solar_jobs
for update
to anon
using (
  sheet_key in ('ngan', 'duNgan', 'langPaeng', 'som', 'bil')
)
with check (
  sheet_key in ('ngan', 'duNgan', 'langPaeng', 'som', 'bil')
);

drop policy if exists "Public update gcal sync" on public.hi_solar_jobs;
create policy "Public update gcal sync"
on public.hi_solar_jobs
for update
to anon
using (true)
with check (true);

drop policy if exists "Public read comments" on public.hi_solar_job_comments;
create policy "Public read comments"
on public.hi_solar_job_comments
for select
to anon
using (true);

drop policy if exists "Public insert comments" on public.hi_solar_job_comments;
create policy "Public insert comments"
on public.hi_solar_job_comments
for insert
to anon
with check (
  job_id is not null
  and length(btrim(message)) > 0
  and author in ('Shine', 'Wassan', 'Wave', 'OT', 'Lui', 'Aoom', 'ไม่ระบุ')
);

drop policy if exists "Public read logs" on public.hi_solar_job_logs;
create policy "Public read logs"
on public.hi_solar_job_logs
for select
to anon
using (true);

drop policy if exists "Public read permits" on public.hi_solar_permits;
create policy "Public read permits"
on public.hi_solar_permits
for select
to anon
using (true);

drop policy if exists "Public insert permits" on public.hi_solar_permits;
create policy "Public insert permits"
on public.hi_solar_permits
for insert
to anon
with check (
  utility_provider in ('PEA', 'MEA')
  and phase in ('PRECHECK', 'DOCS', 'SUBMITTED', 'COMMENT', 'CONTRACT', 'INSTALLED', 'INSPECTION', 'APPROVED', 'CLOSED')
  and status in ('WAITING', 'IN_PROGRESS', 'NEED_FIX', 'DONE', 'REJECTED')
);

drop policy if exists "Public update permits" on public.hi_solar_permits;
create policy "Public update permits"
on public.hi_solar_permits
for update
to anon
using (
  utility_provider in ('PEA', 'MEA')
  and phase in ('PRECHECK', 'DOCS', 'SUBMITTED', 'COMMENT', 'CONTRACT', 'INSTALLED', 'INSPECTION', 'APPROVED', 'CLOSED')
  and status in ('WAITING', 'IN_PROGRESS', 'NEED_FIX', 'DONE', 'REJECTED')
)
with check (
  utility_provider in ('PEA', 'MEA')
  and phase in ('PRECHECK', 'DOCS', 'SUBMITTED', 'COMMENT', 'CONTRACT', 'INSTALLED', 'INSPECTION', 'APPROVED', 'CLOSED')
  and status in ('WAITING', 'IN_PROGRESS', 'NEED_FIX', 'DONE', 'REJECTED')
);

drop policy if exists "Public read permit logs" on public.hi_solar_permit_logs;
create policy "Public read permit logs"
on public.hi_solar_permit_logs
for select
to anon
using (true);

drop policy if exists "Public insert permit logs" on public.hi_solar_permit_logs;
create policy "Public insert permit logs"
on public.hi_solar_permit_logs
for insert
to anon
with check (
  permit_id is not null
  and length(btrim(action)) > 0
  and actor in ('Shine', 'Wassan', 'Wave', 'OT', 'Lui', 'Aoom', 'ไม่ระบุ')
);
