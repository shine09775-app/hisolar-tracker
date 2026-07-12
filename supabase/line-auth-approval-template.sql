-- Hi Solar Tracker
-- LINE auth approval template
-- Replace placeholder values before running in Supabase SQL Editor.
-- Do not leave the placeholder markers in a real production run.

-- 1. Inspect users and pending requests

select
  u.id as app_user_id,
  u.provider_namespace,
  u.line_channel_id,
  u.line_user_id,
  u.display_name,
  u.last_login_at
from public.app_users u
order by u.updated_at desc, u.created_at desc;

select
  ar.id as access_request_id,
  ar.requested_organization,
  ar.status,
  ar.requested_at,
  u.id as app_user_id,
  u.display_name,
  u.provider_namespace,
  u.line_channel_id,
  u.line_user_id
from public.access_requests ar
join public.app_users u
  on u.id = ar.user_id
order by ar.requested_at desc;

-- 2. Approve a Hi Solar member

with target_user as (
  select u.id
  from public.app_users u
  where u.provider_namespace = '<<SYSTEM_PROVIDER_NAMESPACE>>'
    and u.line_user_id = '<<REAL_LINE_USER_ID>>'
)
insert into public.app_memberships (
  user_id,
  organization,
  role,
  status,
  approved_at
)
select
  tu.id,
  'hisolar',
  'member',
  'approved',
  now()
from target_user tu
on conflict (user_id, organization)
do update
set
  role = excluded.role,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();

-- 3. Promote a Hi Solar admin

with target_user as (
  select u.id
  from public.app_users u
  where u.provider_namespace = '<<SYSTEM_PROVIDER_NAMESPACE>>'
    and u.line_user_id = '<<REAL_LINE_USER_ID>>'
)
insert into public.app_memberships (
  user_id,
  organization,
  role,
  status,
  approved_at
)
select
  tu.id,
  'hisolar',
  'admin',
  'approved',
  now()
from target_user tu
on conflict (user_id, organization)
do update
set
  role = excluded.role,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();

-- 4. Approve a JDK commenter

with target_user as (
  select u.id
  from public.app_users u
  where u.provider_namespace = '<<SYSTEM_PROVIDER_NAMESPACE>>'
    and u.line_user_id = '<<REAL_LINE_USER_ID>>'
)
insert into public.app_memberships (
  user_id,
  organization,
  role,
  status,
  approved_at
)
select
  tu.id,
  'jdk',
  'commenter',
  'approved',
  now()
from target_user tu
on conflict (user_id, organization)
do update
set
  role = excluded.role,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();

-- 5. Approve a JDK viewer without comment permission

with target_user as (
  select u.id
  from public.app_users u
  where u.provider_namespace = '<<SYSTEM_PROVIDER_NAMESPACE>>'
    and u.line_user_id = '<<REAL_LINE_USER_ID>>'
)
insert into public.app_memberships (
  user_id,
  organization,
  role,
  status,
  approved_at
)
select
  tu.id,
  'jdk',
  'viewer',
  'approved',
  now()
from target_user tu
on conflict (user_id, organization)
do update
set
  role = excluded.role,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();

-- 6. Mark a pending request as approved after the membership is created

with target_request as (
  select ar.id
  from public.access_requests ar
  join public.app_users u
    on u.id = ar.user_id
  where u.provider_namespace = '<<SYSTEM_PROVIDER_NAMESPACE>>'
    and u.line_user_id = '<<REAL_LINE_USER_ID>>'
    and ar.requested_organization = '<<hisolar_or_jdk>>'
    and ar.status = 'pending'
)
update public.access_requests ar
set
  status = 'approved',
  reviewed_at = now(),
  updated_at = now()
from target_request tr
where ar.id = tr.id;

-- 7. Suspend or revoke access

with target_user as (
  select u.id
  from public.app_users u
  where u.provider_namespace = '<<SYSTEM_PROVIDER_NAMESPACE>>'
    and u.line_user_id = '<<REAL_LINE_USER_ID>>'
)
update public.app_memberships m
set
  status = 'suspended',
  updated_at = now()
from target_user tu
where m.user_id = tu.id
  and m.organization = '<<hisolar_or_jdk>>';

-- Change 'suspended' to 'revoked' if permanent removal is required.
