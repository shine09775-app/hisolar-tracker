create extension if not exists pgcrypto;

create table if not exists public.hi_solar_permits (
  id uuid primary key default gen_random_uuid(),
  sheet_name text not null default 'ขออนุญาต',
  sheet_row integer,
  customer_name text,
  phone text,
  site_name text,
  site_address text,
  utility_provider text not null default 'PEA' check (utility_provider in ('PEA', 'MEA')),
  permit_type text,
  project_type text,
  meter_phase text,
  meter_no text,
  ca_no text,
  pv_kwp numeric,
  inverter_brand text,
  inverter_model text,
  inverter_kw numeric,
  export_mode text,
  workflow_key text not null,
  phase text not null default 'PRECHECK' check (phase in ('PRECHECK', 'DOCS', 'SUBMITTED', 'COMMENT', 'CONTRACT', 'INSTALLED', 'INSPECTION', 'APPROVED', 'CLOSED')),
  status text not null default 'WAITING' check (status in ('WAITING', 'IN_PROGRESS', 'NEED_FIX', 'DONE', 'REJECTED')),
  application_no text,
  submit_date date,
  comment_date date,
  resubmit_date date,
  contract_date date,
  install_date date,
  photo_upload_date date,
  inspection_date date,
  meter_change_date date,
  parallel_date date,
  assigned_to text,
  priority text,
  next_action_date date,
  aging_days integer,
  owner_docs_complete boolean not null default false,
  design_docs_complete boolean not null default false,
  installation_docs_complete boolean not null default false,
  payment_status text,
  remark text,
  document_checklist jsonb not null default jsonb_build_object(
    'id_card', false,
    'house_registration', false,
    'electricity_bill', false,
    'authorization_letter', false,
    'sld', false,
    'inverter_datasheet', false,
    'layout', false,
    'meter_photo', false,
    'mdb_photo', false
  ),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hi_solar_permits_sheet_row_key'
  ) then
    alter table public.hi_solar_permits
      add constraint hi_solar_permits_sheet_row_key unique (sheet_name, sheet_row);
  end if;
end;
$$;

create index if not exists hi_solar_permits_utility_provider_idx
  on public.hi_solar_permits (utility_provider);

create index if not exists hi_solar_permits_phase_idx
  on public.hi_solar_permits (phase);

create index if not exists hi_solar_permits_status_idx
  on public.hi_solar_permits (status);

create index if not exists hi_solar_permits_next_action_date_idx
  on public.hi_solar_permits (next_action_date);

create table if not exists public.hi_solar_permit_logs (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid references public.hi_solar_permits(id) on delete cascade,
  action text not null,
  actor text not null default 'ไม่ระบุ',
  from_phase text,
  to_phase text,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hi_solar_permit_logs_permit_id_idx
  on public.hi_solar_permit_logs (permit_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hi_solar_permits_set_updated_at on public.hi_solar_permits;
create trigger hi_solar_permits_set_updated_at
before update on public.hi_solar_permits
for each row execute function public.set_updated_at();

alter table public.hi_solar_permits enable row level security;
alter table public.hi_solar_permit_logs enable row level security;

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
