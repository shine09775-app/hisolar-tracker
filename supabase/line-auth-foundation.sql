-- Hi Solar Tracker
-- LINE auth database foundation
-- Additive migration only: keeps existing anon policies in place.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  line_provider text not null default 'line',
  line_channel_id text not null,
  line_user_id text not null,
  display_name text not null,
  picture_url text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_line_provider_check
    check (line_provider in ('line'))
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_line_identity_key'
  ) then
    alter table public.app_users
      add constraint app_users_line_identity_key unique (line_channel_id, line_user_id);
  end if;
end;
$$;

create table if not exists public.app_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  organization text not null,
  role text not null default 'member',
  status text not null default 'pending',
  approved_by uuid references public.app_users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_memberships_organization_check
    check (organization in ('hisolar', 'jdk')),
  constraint app_memberships_role_check
    check (role in ('admin', 'member', 'viewer', 'commenter')),
  constraint app_memberships_status_check
    check (status in ('pending', 'approved', 'suspended', 'revoked'))
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_memberships_user_org_key'
  ) then
    alter table public.app_memberships
      add constraint app_memberships_user_org_key unique (user_id, organization);
  end if;
end;
$$;

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  app text not null,
  session_token_hash text not null,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint auth_sessions_app_check
    check (app in ('hisolar', 'jdk'))
);

alter table public.auth_sessions
  add column if not exists app text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'auth_sessions_app_check'
  ) then
    alter table public.auth_sessions
      add constraint auth_sessions_app_check
      check (app in ('hisolar', 'jdk'));
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'auth_sessions'
      and column_name = 'app'
      and is_nullable = 'YES'
  )
  and not exists (
    select 1
    from public.auth_sessions
    where app is null
  ) then
    alter table public.auth_sessions
      alter column app set not null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'auth_sessions_session_token_hash_key'
  ) then
    alter table public.auth_sessions
      add constraint auth_sessions_session_token_hash_key unique (session_token_hash);
  end if;
end;
$$;

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  requested_organization text not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_requests_requested_organization_check
    check (requested_organization in ('hisolar', 'jdk')),
  constraint access_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled'))
);

alter table public.hi_solar_job_comments
  add column if not exists actor_user_id uuid,
  add column if not exists author_name_snapshot text,
  add column if not exists author_picture_url_snapshot text,
  add column if not exists organization text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hi_solar_job_comments_actor_user_id_fkey'
  ) then
    alter table public.hi_solar_job_comments
      add constraint hi_solar_job_comments_actor_user_id_fkey
      foreign key (actor_user_id)
      references public.app_users(id)
      on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hi_solar_job_comments_organization_check'
  ) then
    alter table public.hi_solar_job_comments
      add constraint hi_solar_job_comments_organization_check
      check (organization is null or organization in ('hisolar', 'jdk'));
  end if;
end;
$$;

create index if not exists app_users_line_user_id_idx
  on public.app_users (line_user_id);

create index if not exists app_users_last_login_at_idx
  on public.app_users (last_login_at desc);

create index if not exists app_memberships_user_id_idx
  on public.app_memberships (user_id);

create index if not exists app_memberships_org_status_role_user_idx
  on public.app_memberships (organization, status, role, user_id);

create index if not exists auth_sessions_user_id_idx
  on public.auth_sessions (user_id);

create index if not exists auth_sessions_app_idx
  on public.auth_sessions (app);

create index if not exists auth_sessions_expires_at_idx
  on public.auth_sessions (expires_at);

create index if not exists auth_sessions_active_idx
  on public.auth_sessions (user_id, expires_at)
  where revoked_at is null;

create index if not exists access_requests_user_org_status_idx
  on public.access_requests (user_id, requested_organization, status);

create unique index if not exists access_requests_pending_user_org_key
  on public.access_requests (user_id, requested_organization)
  where status = 'pending';

create index if not exists access_requests_requested_at_idx
  on public.access_requests (requested_at desc);

create index if not exists hi_solar_job_comments_actor_user_id_idx
  on public.hi_solar_job_comments (actor_user_id)
  where actor_user_id is not null;

create index if not exists hi_solar_job_comments_organization_idx
  on public.hi_solar_job_comments (organization)
  where organization is not null;

drop trigger if exists app_users_set_updated_at on public.app_users;
create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

drop trigger if exists app_memberships_set_updated_at on public.app_memberships;
create trigger app_memberships_set_updated_at
before update on public.app_memberships
for each row execute function public.set_updated_at();

drop trigger if exists access_requests_set_updated_at on public.access_requests;
create trigger access_requests_set_updated_at
before update on public.access_requests
for each row execute function public.set_updated_at();

create or replace function public.current_request_organization()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when coalesce(auth.jwt() ->> 'organization', auth.jwt() ->> 'app_organization') in ('hisolar', 'jdk')
      then coalesce(auth.jwt() ->> 'organization', auth.jwt() ->> 'app_organization')
    else null
  end;
$$;

create or replace function public.is_active_membership(required_org text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.app_memberships m
    where m.user_id = auth.uid()
      and m.organization = required_org
      and m.status = 'approved'
  );
$$;

create or replace function public.has_membership_role(required_org text, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.app_memberships m
    where m.user_id = auth.uid()
      and m.organization = required_org
      and m.status = 'approved'
      and m.role = any (allowed_roles)
  );
$$;

create or replace function public.can_manage_organization(required_org text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.has_membership_role(required_org, array['admin']::text[]);
$$;

create or replace function public.is_jdk_job_scope(target_sheet_key text)
returns boolean
language sql
immutable
as $$
  select target_sheet_key in ('ngan', 'langPaeng', 'som');
$$;

create or replace function public.can_read_job_sheet(target_sheet_key text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    public.is_active_membership('hisolar')
    or (
      public.is_active_membership('jdk')
      and public.is_jdk_job_scope(target_sheet_key)
    );
$$;

create or replace function public.can_read_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.hi_solar_jobs j
    where j.id = target_job_id
      and public.can_read_job_sheet(j.sheet_key)
  );
$$;

create or replace function public.can_read_job_log(target_job_id uuid, target_sheet_key text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    public.is_active_membership('hisolar')
    or (
      public.is_active_membership('jdk')
      and (
        (target_job_id is not null and public.can_read_job(target_job_id))
        or (target_job_id is null and public.is_jdk_job_scope(target_sheet_key))
      )
    );
$$;

create or replace function public.can_insert_comment(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    (
      public.has_membership_role('hisolar', array['admin', 'member']::text[])
      and public.can_read_job(target_job_id)
    )
    or (
      public.has_membership_role('jdk', array['admin', 'commenter']::text[])
      and exists (
        select 1
        from public.hi_solar_jobs j
        where j.id = target_job_id
          and public.is_jdk_job_scope(j.sheet_key)
      )
    );
$$;

create or replace function public.can_view_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    target_user_id = auth.uid()
    or exists (
      select 1
      from public.app_memberships requester
      join public.app_memberships target
        on target.user_id = target_user_id
       and target.organization = requester.organization
      where requester.user_id = auth.uid()
        and requester.status = 'approved'
        and requester.role = 'admin'
    );
$$;

create or replace function public.can_view_membership(target_user_id uuid, target_org text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    target_user_id = auth.uid()
    or public.can_manage_organization(target_org);
$$;

create or replace function public.can_view_access_request(target_user_id uuid, target_org text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    target_user_id = auth.uid()
    or public.can_manage_organization(target_org);
$$;

create or replace function public.apply_comment_actor_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  resolved_display_name text;
  resolved_picture_url text;
  claim_org text;
  has_hisolar boolean;
  has_jdk boolean;
begin
  if auth.uid() is not null then
    new.actor_user_id := auth.uid();
  end if;

  if new.actor_user_id is not null then
    select u.display_name, u.picture_url
      into resolved_display_name, resolved_picture_url
    from public.app_users u
    where u.id = new.actor_user_id;

    new.author_name_snapshot := resolved_display_name;
    new.author_picture_url_snapshot := resolved_picture_url;

    if resolved_display_name is not null then
      new.author := resolved_display_name;
    elsif coalesce(btrim(new.author), '') = '' then
      new.author := 'ไม่ระบุ';
    end if;
  end if;

  if new.actor_user_id is not null then
    claim_org := public.current_request_organization();

    if claim_org in ('hisolar', 'jdk') then
      new.organization := claim_org;
    else
      select
        exists (
          select 1
          from public.app_memberships m
          where m.user_id = new.actor_user_id
            and m.organization = 'hisolar'
            and m.status = 'approved'
        ),
        exists (
          select 1
          from public.app_memberships m
          where m.user_id = new.actor_user_id
            and m.organization = 'jdk'
            and m.status = 'approved'
        )
      into has_hisolar, has_jdk;

      if has_hisolar and not has_jdk then
        new.organization := 'hisolar';
      elsif has_jdk and not has_hisolar then
        new.organization := 'jdk';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists hi_solar_job_comments_apply_actor_snapshot on public.hi_solar_job_comments;
create trigger hi_solar_job_comments_apply_actor_snapshot
before insert or update on public.hi_solar_job_comments
for each row execute function public.apply_comment_actor_snapshot();

alter table public.app_users enable row level security;
alter table public.app_memberships enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.access_requests enable row level security;

drop policy if exists "Authenticated read app_users self or org admin" on public.app_users;
create policy "Authenticated read app_users self or org admin"
on public.app_users
for select
to authenticated
using (public.can_view_user(id));

drop policy if exists "Authenticated read app_memberships self or org admin" on public.app_memberships;
create policy "Authenticated read app_memberships self or org admin"
on public.app_memberships
for select
to authenticated
using (public.can_view_membership(user_id, organization));

drop policy if exists "Authenticated insert app_memberships org admin" on public.app_memberships;
create policy "Authenticated insert app_memberships org admin"
on public.app_memberships
for insert
to authenticated
with check (public.can_manage_organization(organization));

drop policy if exists "Authenticated update app_memberships org admin" on public.app_memberships;
create policy "Authenticated update app_memberships org admin"
on public.app_memberships
for update
to authenticated
using (public.can_manage_organization(organization))
with check (public.can_manage_organization(organization));

drop policy if exists "Authenticated read access_requests self or org admin" on public.access_requests;
create policy "Authenticated read access_requests self or org admin"
on public.access_requests
for select
to authenticated
using (public.can_view_access_request(user_id, requested_organization));

drop policy if exists "Authenticated insert access_requests self pending" on public.access_requests;
create policy "Authenticated insert access_requests self pending"
on public.access_requests
for insert
to authenticated
with check (
  user_id = auth.uid()
  and requested_organization in ('hisolar', 'jdk')
  and status = 'pending'
);

drop policy if exists "Authenticated update access_requests org admin" on public.access_requests;
create policy "Authenticated update access_requests org admin"
on public.access_requests
for update
to authenticated
using (public.can_manage_organization(requested_organization))
with check (public.can_manage_organization(requested_organization));

drop policy if exists "Authenticated read jobs by membership" on public.hi_solar_jobs;
create policy "Authenticated read jobs by membership"
on public.hi_solar_jobs
for select
to authenticated
using (public.can_read_job_sheet(sheet_key));

drop policy if exists "Authenticated insert jobs hisolar admin member" on public.hi_solar_jobs;
create policy "Authenticated insert jobs hisolar admin member"
on public.hi_solar_jobs
for insert
to authenticated
with check (
  public.has_membership_role('hisolar', array['admin', 'member']::text[])
  and sheet_key in ('ngan', 'duNgan', 'langPaeng', 'som', 'bil')
);

drop policy if exists "Authenticated update jobs hisolar admin member" on public.hi_solar_jobs;
create policy "Authenticated update jobs hisolar admin member"
on public.hi_solar_jobs
for update
to authenticated
using (public.has_membership_role('hisolar', array['admin', 'member']::text[]))
with check (
  public.has_membership_role('hisolar', array['admin', 'member']::text[])
  and sheet_key in ('ngan', 'duNgan', 'langPaeng', 'som', 'bil')
);

drop policy if exists "Authenticated read comments by visible job" on public.hi_solar_job_comments;
create policy "Authenticated read comments by visible job"
on public.hi_solar_job_comments
for select
to authenticated
using (public.can_read_job(job_id));

drop policy if exists "Authenticated insert comments by membership" on public.hi_solar_job_comments;
create policy "Authenticated insert comments by membership"
on public.hi_solar_job_comments
for insert
to authenticated
with check (
  job_id is not null
  and length(btrim(message)) > 0
  and public.can_insert_comment(job_id)
  and actor_user_id = auth.uid()
  and organization = public.current_request_organization()
);

drop policy if exists "Authenticated read job logs by membership" on public.hi_solar_job_logs;
create policy "Authenticated read job logs by membership"
on public.hi_solar_job_logs
for select
to authenticated
using (public.can_read_job_log(job_id, sheet_key));

drop policy if exists "Authenticated read permits hisolar admin member" on public.hi_solar_permits;
create policy "Authenticated read permits hisolar admin member"
on public.hi_solar_permits
for select
to authenticated
using (public.has_membership_role('hisolar', array['admin', 'member']::text[]));

drop policy if exists "Authenticated insert permits hisolar admin member" on public.hi_solar_permits;
create policy "Authenticated insert permits hisolar admin member"
on public.hi_solar_permits
for insert
to authenticated
with check (public.has_membership_role('hisolar', array['admin', 'member']::text[]));

drop policy if exists "Authenticated update permits hisolar admin member" on public.hi_solar_permits;
create policy "Authenticated update permits hisolar admin member"
on public.hi_solar_permits
for update
to authenticated
using (public.has_membership_role('hisolar', array['admin', 'member']::text[]))
with check (public.has_membership_role('hisolar', array['admin', 'member']::text[]));

drop policy if exists "Authenticated read permit logs hisolar admin member" on public.hi_solar_permit_logs;
create policy "Authenticated read permit logs hisolar admin member"
on public.hi_solar_permit_logs
for select
to authenticated
using (public.has_membership_role('hisolar', array['admin', 'member']::text[]));

drop policy if exists "Authenticated insert permit logs hisolar admin member" on public.hi_solar_permit_logs;
create policy "Authenticated insert permit logs hisolar admin member"
on public.hi_solar_permit_logs
for insert
to authenticated
with check (public.has_membership_role('hisolar', array['admin', 'member']::text[]));

-- No authenticated policies are created on public.auth_sessions.
-- Service-role/server access remains the intended path for session management.
