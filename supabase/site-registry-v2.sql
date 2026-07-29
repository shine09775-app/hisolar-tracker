-- =============================================================================
-- Hi Solar Tracker — Site Registry v2: site-centric workflow
-- =============================================================================
-- Sprint 1 built the registry from vendor exports. This completes the model so
-- the site is the anchor every piece of work hangs off, covering three paths:
--
--   1. new job on an existing customer  -> search sites, attach job.site_id
--   2. new installation                 -> create a site (source='manual',
--                                          lifecycle='installing'), attach jobs;
--                                          fill in platform/plant id later once
--                                          the inverter is registered in the
--                                          vendor portal
--   3. service work                     -> attach to the existing site, history
--                                          accumulates on that site
--
-- Runs after supabase/site-registry.sql. Idempotent.
-- Rollback: supabase/site-registry-v2-rollback.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Provenance + lifecycle
-- ---------------------------------------------------------------------------
-- A site created in the field has no vendor plant id yet, so platform_code and
-- platform_plant_id must both stay nullable. The existing
-- unique (platform_code, platform_plant_id) already tolerates NULLs in Postgres,
-- so manual sites never collide with each other.
alter table public.hi_solar_sites
  add column if not exists source text not null default 'import',
  add column if not exists lifecycle text not null default 'active',
  add column if not exists created_by text,
  add column if not exists notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hi_solar_sites_source_chk') then
    alter table public.hi_solar_sites
      add constraint hi_solar_sites_source_chk check (source in ('import', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hi_solar_sites_lifecycle_chk') then
    alter table public.hi_solar_sites
      add constraint hi_solar_sites_lifecycle_chk
      check (lifecycle in ('lead', 'installing', 'active', 'inactive'));
  end if;
end $$;

-- everything loaded so far came from the vendor exports
update public.hi_solar_sites set source = 'import' where source is null;

-- ---------------------------------------------------------------------------
-- 2) Service scheduling + warranty (the maintenance registry this was for)
-- ---------------------------------------------------------------------------
alter table public.hi_solar_sites
  add column if not exists clean_interval_months integer,
  add column if not exists next_clean_date date,
  add column if not exists warranty_inverter_expiry date,
  add column if not exists warranty_panel_expiry date,
  add column if not exists inverter_model text,
  add column if not exists inverter_count integer,
  add column if not exists panel_count integer;

create index if not exists hi_solar_sites_next_clean_idx
  on public.hi_solar_sites (next_clean_date) where next_clean_date is not null;
create index if not exists hi_solar_sites_lifecycle_idx on public.hi_solar_sites (lifecycle);

-- ---------------------------------------------------------------------------
-- 3) site_code for sites created by hand
-- ---------------------------------------------------------------------------
-- Imported sites carry HS-0001..HS-0271. Keep one shared sequence so a site
-- created in the field gets the next code rather than a colliding one.
create sequence if not exists public.hi_solar_site_code_seq;

select setval(
  'public.hi_solar_site_code_seq',
  greatest(
    (select coalesce(max(substring(site_code from '^HS-(\d+)$')::int), 0) from public.hi_solar_sites),
    1
  )
);

create or replace function public.next_hi_solar_site_code()
returns text
language sql
security definer
set search_path = public
as $$
  select 'HS-' || lpad(nextval('public.hi_solar_site_code_seq')::text, 4, '0');
$$;

revoke all on function public.next_hi_solar_site_code() from public, anon;
grant execute on function public.next_hi_solar_site_code() to authenticated, service_role;

create or replace function public.set_hi_solar_site_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.site_code is null or new.site_code = '' then
    new.site_code := public.next_hi_solar_site_code();
  end if;
  return new;
end $$;

drop trigger if exists hi_solar_sites_set_code on public.hi_solar_sites;
create trigger hi_solar_sites_set_code
  before insert on public.hi_solar_sites
  for each row execute function public.set_hi_solar_site_code();

-- ---------------------------------------------------------------------------
-- 4) Rollup view — one row per site with its service history summarised
-- ---------------------------------------------------------------------------
-- security_invoker keeps hi_solar_sites' RLS in force for whoever selects.
drop view if exists public.hi_solar_site_overview;
create view public.hi_solar_site_overview
with (security_invoker = true) as
select
  s.*,
  b.brand_name,
  p.application_name,
  coalesce(j.job_count, 0)     as job_count,
  coalesce(j.clean_count, 0)   as clean_count,
  coalesce(j.repair_count, 0)  as repair_count,
  j.last_clean_date,
  j.last_repair_date,
  j.last_job_date,
  coalesce(pm.permit_count, 0) as permit_count,
  case
    when s.next_clean_date is null then null
    when s.next_clean_date < current_date then 'overdue'
    when s.next_clean_date <= current_date + 30 then 'due_soon'
    else 'scheduled'
  end as clean_due_state
from public.hi_solar_sites s
left join public.hi_solar_inverter_brands b on b.brand_code = s.brand_code
left join public.hi_solar_platforms      p on p.platform_code = s.platform_code
left join lateral (
  select
    count(*)                                                              as job_count,
    count(*) filter (where sheet_key = 'langPaeng')                       as clean_count,
    count(*) filter (where sheet_key = 'som')                             as repair_count,
    max(coalesce(job_date, appointment_date)) filter (where sheet_key = 'langPaeng') as last_clean_date,
    max(coalesce(job_date, appointment_date)) filter (where sheet_key = 'som')       as last_repair_date,
    max(coalesce(job_date, appointment_date))                             as last_job_date
  from public.hi_solar_jobs
  where site_id = s.id
) j on true
left join lateral (
  select count(*) as permit_count
  from public.hi_solar_permits
  where site_id = s.id
) pm on true;

grant select on public.hi_solar_site_overview to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Keep next_clean_date honest
-- ---------------------------------------------------------------------------
-- When a cleaning job is filed against a site that has an interval set, roll
-- the next due date forward. Sites without an interval are left alone.
create or replace function public.bump_site_next_clean()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  done_on date;
begin
  if new.site_id is null or new.sheet_key <> 'langPaeng' then
    return new;
  end if;
  done_on := coalesce(new.job_date, new.appointment_date);
  if done_on is null then
    return new;
  end if;
  update public.hi_solar_sites
     set next_clean_date = done_on + (clean_interval_months || ' months')::interval
   where id = new.site_id
     and clean_interval_months is not null
     and (next_clean_date is null or next_clean_date <= done_on);
  return new;
end $$;

drop trigger if exists hi_solar_jobs_bump_clean on public.hi_solar_jobs;
create trigger hi_solar_jobs_bump_clean
  after insert or update of job_date, appointment_date, site_id on public.hi_solar_jobs
  for each row execute function public.bump_site_next_clean();

-- =============================================================================
-- done.
-- =============================================================================
