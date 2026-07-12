-- Hi Solar Tracker
-- Emergency rollback for LINE auth RLS app scoping migration
-- Restores pre-scoped authenticated helper and policy behavior.

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
