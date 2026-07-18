# Hi Solar member approval runbook

Use this after each Hi Solar team member signs in with LINE once.

Do not approve Hi Solar users automatically. Hi Solar users can update jobs and operational status, so approval should remain explicit.

## 1. List pending Hi Solar users

Run in Supabase SQL Editor:

```sql
select
  ar.id as access_request_id,
  ar.requested_at,
  u.id as app_user_id,
  u.display_name,
  u.picture_url is not null as has_picture,
  left(u.line_user_id, 4) || '…' || right(u.line_user_id, 4) as masked_line_user_id
from public.access_requests ar
join public.app_users u on u.id = ar.user_id
where ar.requested_organization = 'hisolar'
  and ar.status = 'pending'
order by ar.requested_at desc;
```

## 2. Approve one Hi Solar member

Replace `<<APP_USER_ID>>` with the `app_user_id` from the pending list.

```sql
with target_user as (
  select '<<APP_USER_ID>>'::uuid as id
)
insert into public.app_memberships (
  user_id,
  organization,
  role,
  status,
  approved_at
)
select
  id,
  'hisolar',
  'member',
  'approved',
  now()
from target_user
on conflict (user_id, organization)
do update
set
  role = excluded.role,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();

update public.access_requests
set
  status = 'approved',
  reviewed_at = now(),
  updated_at = now()
where user_id = '<<APP_USER_ID>>'::uuid
  and requested_organization = 'hisolar'
  and status = 'pending';
```

## 3. Approve one Hi Solar admin

Use this only for users who should manage users or perform full Hi Solar actions.

```sql
with target_user as (
  select '<<APP_USER_ID>>'::uuid as id
)
insert into public.app_memberships (
  user_id,
  organization,
  role,
  status,
  approved_at
)
select
  id,
  'hisolar',
  'admin',
  'approved',
  now()
from target_user
on conflict (user_id, organization)
do update
set
  role = excluded.role,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();

update public.access_requests
set
  status = 'approved',
  reviewed_at = now(),
  updated_at = now()
where user_id = '<<APP_USER_ID>>'::uuid
  and requested_organization = 'hisolar'
  and status = 'pending';
```

## 4. Approve up to 4 selected Hi Solar users in one run

Use this when the 4 Hi Solar team members have already signed in once and are visible in the pending list. Replace each `<<APP_USER_ID_*>>` and choose `member` or `admin` per person. If approving fewer than 4 users, delete the unused `values` rows before running.

```sql
with selected_users(user_id, role) as (
  values
    ('<<APP_USER_ID_1>>'::uuid, 'member'),
    ('<<APP_USER_ID_2>>'::uuid, 'member'),
    ('<<APP_USER_ID_3>>'::uuid, 'member'),
    ('<<APP_USER_ID_4>>'::uuid, 'member')
),
valid_users as (
  select
    user_id,
    role
  from selected_users
  where role in ('admin', 'member')
)
insert into public.app_memberships (
  user_id,
  organization,
  role,
  status,
  approved_at
)
select
  user_id,
  'hisolar',
  role,
  'approved',
  now()
from valid_users
on conflict (user_id, organization)
do update
set
  role = excluded.role,
  status = excluded.status,
  approved_at = excluded.approved_at,
  updated_at = now();

update public.access_requests ar
set
  status = 'approved',
  reviewed_at = now(),
  updated_at = now()
from selected_users su
where ar.user_id = su.user_id
  and ar.requested_organization = 'hisolar'
  and ar.status = 'pending';
```

Verify after approval:

```sql
select
  u.display_name,
  m.organization,
  m.role,
  m.status,
  m.approved_at
from public.app_memberships m
join public.app_users u on u.id = m.user_id
where m.organization = 'hisolar'
order by m.approved_at desc;
```

## 5. Suggested process for the next 4 users

1. Send the Preview or Production URL.
2. Ask each person to sign in with LINE once.
3. Confirm their LINE display name in the pending list.
4. Approve normal staff as `member`.
5. Approve only owners/admin operators as `admin`.
6. Ask them to sign in again after approval.
