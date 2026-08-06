-- =============================================================================
-- Rollback for supabase/deye-cloud-sync.sql
-- =============================================================================
-- Puts the DEYECLOUD dimension row back to how site-registry.sql described it
-- and drops the index the sync's name lookup added.
--
-- This does NOT remove sites already pulled in from the Deye Cloud API. To do
-- that as well, run the delete at the bottom — read it first.
-- =============================================================================

drop index if exists public.hi_solar_sites_name_norm_idx;

update public.hi_solar_platforms
set application_name = 'Deye Cloud',
    brand_code       = 'DEYE',
    monitoring_level = 'device',
    status           = 'active',
    export_format    = 'xlsx',
    key_field        = 'SN',
    notes            = 'ระดับ device/inverter'
where platform_code = 'DEYECLOUD';

-- Destructive — uncomment only if you want the imported stations gone too.
-- Jobs and permits reference sites via on delete set null, so they survive,
-- but they lose the link and have to be re-attached in link-jobs.html.
--
-- delete from public.hi_solar_sites
-- where platform_code = 'DEYECLOUD' and source_file = 'deye-cloud-api';
