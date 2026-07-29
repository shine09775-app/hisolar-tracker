-- Rollback for supabase/site-registry.sql (Sprint 1: Data Foundation)
-- Drops the site link columns, the registry, and the dimension tables.
-- NOTE: dropping hi_solar_sites will null out jobs/permits.site_id first.

alter table if exists public.hi_solar_jobs    drop column if exists site_id;
alter table if exists public.hi_solar_permits drop column if exists site_id;

drop table if exists public.hi_solar_sites cascade;
drop table if exists public.hi_solar_platforms cascade;
drop table if exists public.hi_solar_inverter_brands cascade;
