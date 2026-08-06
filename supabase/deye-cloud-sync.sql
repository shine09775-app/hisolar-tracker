-- =============================================================================
-- Hi Solar Tracker — Deye Cloud API sync
-- =============================================================================
-- The registry was built from spreadsheet exports, so DEYECLOUD was registered
-- as a device-level platform keyed by inverter SN — that was the shape of the
-- xlsx we had. /api/sites/sync-deye now reads /v1.0/station/list straight from
-- the Deye Cloud OpenAPI, which is plant-level and keyed by the numeric station
-- id, so the dimension row is corrected to describe what actually feeds it.
--
-- No table changes: hi_solar_sites already carries every column the sync fills,
-- and unique (platform_code, platform_plant_id) already makes repeat runs
-- idempotent.
--
-- Idempotent. Apply with: psql "$SUPABASE_DB_URL" -f supabase/deye-cloud-sync.sql
--                    or:  paste into the Supabase SQL editor
-- Rollback: supabase/deye-cloud-sync-rollback.sql
-- =============================================================================

update public.hi_solar_platforms
set application_name = 'Deye Cloud',
    brand_code       = 'DEYE',
    monitoring_level = 'plant',
    status           = 'active',
    export_format    = 'api',
    key_field        = 'Station ID (numeric)',
    notes            = 'ดึงผ่าน OpenAPI /v1.0/station/list — ดู api/sites/sync-deye.js'
where platform_code = 'DEYECLOUD';

-- Deye plants imported from the Solarman export stay on SOLARMAN. The sync
-- matches them by site name and skips them rather than importing a second copy;
-- see api/_lib/deye-site-mapping.js.

-- The sync looks every station up by (platform_code, platform_plant_id) and
-- then by name, on every run. Index the name the same way the lookup
-- normalises it so the plan stays cheap as the registry grows.
create index if not exists hi_solar_sites_name_norm_idx
  on public.hi_solar_sites (lower(regexp_replace(site_name, '\s+', ' ', 'g')));

-- =============================================================================
-- done.
-- =============================================================================
