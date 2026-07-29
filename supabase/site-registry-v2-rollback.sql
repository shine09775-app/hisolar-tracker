-- Rollback for supabase/site-registry-v2.sql
-- Leaves the Sprint 1 registry (site-registry.sql) intact.

drop trigger if exists hi_solar_jobs_bump_clean on public.hi_solar_jobs;
drop function if exists public.bump_site_next_clean();

drop view if exists public.hi_solar_site_overview;

drop trigger if exists hi_solar_sites_set_code on public.hi_solar_sites;
drop function if exists public.set_hi_solar_site_code();
drop function if exists public.next_hi_solar_site_code();
drop sequence if exists public.hi_solar_site_code_seq;

drop index if exists public.hi_solar_sites_next_clean_idx;
drop index if exists public.hi_solar_sites_lifecycle_idx;

alter table public.hi_solar_sites
  drop constraint if exists hi_solar_sites_source_chk,
  drop constraint if exists hi_solar_sites_lifecycle_chk;

alter table public.hi_solar_sites
  drop column if exists source,
  drop column if exists lifecycle,
  drop column if exists created_by,
  drop column if exists notes,
  drop column if exists clean_interval_months,
  drop column if exists next_clean_date,
  drop column if exists warranty_inverter_expiry,
  drop column if exists warranty_panel_expiry,
  drop column if exists inverter_model,
  drop column if exists inverter_count,
  drop column if exists panel_count;
