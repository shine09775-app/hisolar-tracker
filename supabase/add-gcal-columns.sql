-- Migration: add Google Calendar sync columns to hi_solar_jobs
-- Run this once in Supabase SQL Editor

alter table public.hi_solar_jobs
  add column if not exists gcal_event_id text,
  add column if not exists gcal_synced_at timestamptz;

create index if not exists hi_solar_jobs_gcal_event_id_idx
  on public.hi_solar_jobs (gcal_event_id)
  where gcal_event_id is not null;

-- Allow anon role to update gcal columns (needed if using anon key in webhook)
-- If using service_role key in webhook, this policy is not required
-- but it's harmless to have.
drop policy if exists "Public update gcal sync" on public.hi_solar_jobs;
create policy "Public update gcal sync"
on public.hi_solar_jobs
for update
to anon
using (true)
with check (true);
