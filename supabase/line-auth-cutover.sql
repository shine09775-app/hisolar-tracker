-- Hi Solar Tracker
-- LINE auth production cutover
-- Removes legacy anon browser policies after authenticated JWT paths are verified.

drop policy if exists "Public read jobs" on public.hi_solar_jobs;
drop policy if exists "Public insert jobs" on public.hi_solar_jobs;
drop policy if exists "Public update jobs" on public.hi_solar_jobs;
drop policy if exists "Public update gcal sync" on public.hi_solar_jobs;

drop policy if exists "Public read comments" on public.hi_solar_job_comments;
drop policy if exists "Public insert comments" on public.hi_solar_job_comments;

drop policy if exists "Public read logs" on public.hi_solar_job_logs;

drop policy if exists "Public read permits" on public.hi_solar_permits;
drop policy if exists "Public insert permits" on public.hi_solar_permits;
drop policy if exists "Public update permits" on public.hi_solar_permits;

drop policy if exists "Public read permit logs" on public.hi_solar_permit_logs;
drop policy if exists "Public insert permit logs" on public.hi_solar_permit_logs;
