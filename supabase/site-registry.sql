-- =============================================================================
-- Hi Solar Tracker — Site Registry (Sprint 1: Data Foundation)
-- =============================================================================
-- Adds a canonical site/plant registry that unifies every inverter brand and
-- monitoring app into one table, plus small dimension tables for inverter
-- brands and monitoring platforms. Existing jobs & permits are linked to a
-- site via a nullable site_id so the per-site "Tag / timeline" view can
-- aggregate all service work.
--
-- Safe to run more than once (idempotent). Mirrors the RLS conventions used by
-- hi_solar_jobs: a permissive "Public" layer plus org-scoped "Authenticated"
-- policies via the existing helper functions
--   public.current_request_organization()
--   public.has_membership_role('hisolar', array['admin','member'])
-- Apply with:  psql "$SUPABASE_DB_URL" -f supabase/site-registry.sql
--         or:  paste into Supabase SQL editor
-- Rollback:    supabase/site-registry-rollback.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Dimension: inverter brands
-- ---------------------------------------------------------------------------
create table if not exists public.hi_solar_inverter_brands (
  brand_code   text primary key,
  brand_name   text not null,
  manufacturer text,
  country      text,
  notes        text,
  created_at   timestamptz not null default now()
);

insert into public.hi_solar_inverter_brands (brand_code, brand_name, manufacturer, country, notes) values
  ('HUAWEI',   'Huawei',        'Huawei Technologies',              'China', null),
  ('DEYE',     'Deye',          'Ningbo Deye Inverter Technology',  'China', 'OEM ให้หลายแบรนด์'),
  ('SOLIS',    'Solis',         'Ginlong Technologies',             'China', 'แบรนด์ Solis = Ginlong'),
  ('FELICITY', 'Felicity Solar','Felicity Solar',                   'China', null),
  ('GROWATT',  'Growatt',       'Growatt New Energy',               'China', null)
on conflict (brand_code) do update
  set brand_name = excluded.brand_name,
      manufacturer = excluded.manufacturer,
      country = excluded.country,
      notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- 2) Dimension: monitoring platforms (application <-> brand)
-- ---------------------------------------------------------------------------
create table if not exists public.hi_solar_platforms (
  platform_code    text primary key,
  application_name text not null,
  brand_code       text references public.hi_solar_inverter_brands(brand_code),
  monitoring_level text not null default 'plant' check (monitoring_level in ('plant', 'device')),
  status           text not null default 'active' check (status in ('active', 'pending')),
  export_format    text,
  key_field        text,
  notes            text,
  created_at       timestamptz not null default now()
);

insert into public.hi_solar_platforms
  (platform_code, application_name, brand_code, monitoring_level, status, export_format, key_field, notes) values
  ('FUSIONSOLAR','FusionSolar','HUAWEI',  'plant',  'active',  'xlsx (2 sheets)','Plant Name',    'merge Plant Information + Plant_Detail'),
  ('SOLARMAN',   'Solarman',   'DEYE',    'plant',  'active',  'xlsx',           'ID (numeric)',  'white-label; ปัจจุบันใช้กับ Deye'),
  ('DEYECLOUD',  'Deye Cloud', 'DEYE',    'device', 'active',  'xlsx',           'SN',            'ระดับ device/inverter'),
  ('SOLISCLOUD', 'SolisCloud', 'SOLIS',   'plant',  'active',  'xls',            'Plant ID (hex)','header ซ้อน 5 แถว'),
  ('FSOLAR',     'Fsolar',     'FELICITY','plant',  'pending', null,             null,            'ยังมีแต่ screenshot'),
  ('SHINEPHONE', 'ShinePhone', 'GROWATT', 'plant',  'pending', null,             null,            'ยังมีแต่ screenshot')
on conflict (platform_code) do update
  set application_name = excluded.application_name,
      brand_code = excluded.brand_code,
      monitoring_level = excluded.monitoring_level,
      status = excluded.status,
      export_format = excluded.export_format,
      key_field = excluded.key_field,
      notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- 3) Fact: canonical site registry
-- ---------------------------------------------------------------------------
create table if not exists public.hi_solar_sites (
  id                uuid primary key default gen_random_uuid(),
  site_code         text unique,                       -- internal id e.g. HS-0001
  organization      text not null default 'hisolar',   -- for org-scoped RLS

  -- source / linkage
  platform_code     text references public.hi_solar_platforms(platform_code),
  brand_code        text references public.hi_solar_inverter_brands(brand_code),
  platform_plant_id text,                               -- vendor key (Plant Name / ID / hex)
  source_file       text,

  -- identity
  site_name         text not null,
  customer_name     text,
  phone             text,
  contact_person    text,
  contact_method    text,

  -- location
  address           text,
  province          text,
  latitude          numeric,
  longitude         numeric,
  maps_url          text,

  -- system
  capacity_kwp      numeric,
  status            text,                               -- Online / Offline / null
  grid_connection_date date,

  -- performance snapshot (from last export; nullable per platform)
  current_power_kw  numeric,
  yield_today_kwh   numeric,
  total_yield_kwh   numeric,

  raw_data          jsonb not null default '{}'::jsonb,
  synced_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- one physical plant per (platform, vendor id) => idempotent upsert key
  unique (platform_code, platform_plant_id)
);

create index if not exists hi_solar_sites_org_idx        on public.hi_solar_sites (organization);
create index if not exists hi_solar_sites_platform_idx   on public.hi_solar_sites (platform_code);
create index if not exists hi_solar_sites_brand_idx      on public.hi_solar_sites (brand_code);
create index if not exists hi_solar_sites_name_idx       on public.hi_solar_sites (lower(site_name));

-- keep updated_at fresh (reuse existing trigger fn if present)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists set_hi_solar_sites_updated_at on public.hi_solar_sites;
    create trigger set_hi_solar_sites_updated_at
      before update on public.hi_solar_sites
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Link existing jobs & permits to a site (nullable; backfill later)
-- ---------------------------------------------------------------------------
alter table public.hi_solar_jobs
  add column if not exists site_id uuid references public.hi_solar_sites(id) on delete set null;
alter table public.hi_solar_permits
  add column if not exists site_id uuid references public.hi_solar_sites(id) on delete set null;

create index if not exists hi_solar_jobs_site_idx    on public.hi_solar_jobs (site_id);
create index if not exists hi_solar_permits_site_idx on public.hi_solar_permits (site_id);

-- ---------------------------------------------------------------------------
-- 5) Row Level Security (mirror hi_solar_jobs: public layer + org-scoped)
-- ---------------------------------------------------------------------------
alter table public.hi_solar_sites             enable row level security;
alter table public.hi_solar_inverter_brands   enable row level security;
alter table public.hi_solar_platforms         enable row level security;

-- reference tables: readable by everyone
drop policy if exists "Public read brands" on public.hi_solar_inverter_brands;
create policy "Public read brands" on public.hi_solar_inverter_brands for select using (true);

drop policy if exists "Public read platforms" on public.hi_solar_platforms;
create policy "Public read platforms" on public.hi_solar_platforms for select using (true);

-- sites: permissive layer (matches existing "Public read/insert/update jobs")
drop policy if exists "Public read sites" on public.hi_solar_sites;
create policy "Public read sites" on public.hi_solar_sites for select using (true);

drop policy if exists "Public insert sites" on public.hi_solar_sites;
create policy "Public insert sites" on public.hi_solar_sites for insert with check (true);

drop policy if exists "Public update sites" on public.hi_solar_sites;
create policy "Public update sites" on public.hi_solar_sites for update using (true) with check (true);

-- sites: org-scoped authenticated layer (guard writes to hisolar admin/member)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'current_request_organization')
     and exists (select 1 from pg_proc where proname = 'has_membership_role') then

    execute $p$drop policy if exists "Authenticated read sites by org" on public.hi_solar_sites$p$;
    execute $p$create policy "Authenticated read sites by org"
      on public.hi_solar_sites for select to authenticated
      using (organization = public.current_request_organization())$p$;

    execute $p$drop policy if exists "Authenticated write sites hisolar admin member" on public.hi_solar_sites$p$;
    execute $p$create policy "Authenticated write sites hisolar admin member"
      on public.hi_solar_sites for all to authenticated
      using (
        public.current_request_organization() = 'hisolar'
        and public.has_membership_role('hisolar', array['admin','member']::text[])
      )
      with check (
        organization = 'hisolar'
        and public.current_request_organization() = 'hisolar'
        and public.has_membership_role('hisolar', array['admin','member']::text[])
      )$p$;
  end if;
end $$;

-- =============================================================================
-- done. Next: run scripts/import-site-registry.mjs to load the 271 sites.
-- =============================================================================
