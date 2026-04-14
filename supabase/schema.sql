create extension if not exists pgcrypto;

create table if not exists public.hi_solar_jobs (
  id uuid primary key default gen_random_uuid(),
  sheet_key text not null check (sheet_key in ('ngan', 'duNgan', 'langPaeng', 'som', 'bil')),
  sheet_name text not null,
  sheet_row integer,
  customer_name text,
  title text,
  detail text,
  phone text,
  job_date date,
  job_time time,
  created_date date,
  appointment_date date,
  sent_date date,
  received_date date,
  technician text,
  job_type text,
  price numeric,
  amount numeric,
  maps_url text,
  status text,
  note text,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hi_solar_jobs_sheet_row_key'
  ) then
    alter table public.hi_solar_jobs
      add constraint hi_solar_jobs_sheet_row_key unique (sheet_key, sheet_row);
  end if;
end;
$$;

create index if not exists hi_solar_jobs_sheet_key_idx
  on public.hi_solar_jobs (sheet_key);

create index if not exists hi_solar_jobs_job_date_idx
  on public.hi_solar_jobs (job_date);

create index if not exists hi_solar_jobs_status_idx
  on public.hi_solar_jobs (status);

create table if not exists public.hi_solar_job_comments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.hi_solar_jobs(id) on delete cascade,
  author text not null default 'ไม่ระบุ',
  message text not null,
  source text not null default 'app',
  source_key text,
  commented_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.hi_solar_job_comments
  add column if not exists commented_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hi_solar_job_comments_source_key_key'
  ) then
    alter table public.hi_solar_job_comments
      add constraint hi_solar_job_comments_source_key_key unique (source, source_key);
  end if;
end;
$$;

create index if not exists hi_solar_job_comments_job_id_idx
  on public.hi_solar_job_comments (job_id, created_at);

create index if not exists hi_solar_job_comments_job_time_idx
  on public.hi_solar_job_comments (job_id, commented_at);

create table if not exists public.hi_solar_job_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.hi_solar_jobs(id) on delete set null,
  sheet_key text,
  sheet_row integer,
  action text not null,
  actor text not null default 'ไม่ระบุ',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hi_solar_job_logs_job_id_idx
  on public.hi_solar_job_logs (job_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hi_solar_jobs_set_updated_at on public.hi_solar_jobs;
create trigger hi_solar_jobs_set_updated_at
before update on public.hi_solar_jobs
for each row execute function public.set_updated_at();

alter table public.hi_solar_jobs enable row level security;
alter table public.hi_solar_job_comments enable row level security;
alter table public.hi_solar_job_logs enable row level security;

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

-- Browser app can read, insert, and update jobs with the anon key for internal team usage.
-- Google Apps Script bulk sync uses the service_role key stored in Script Properties.
