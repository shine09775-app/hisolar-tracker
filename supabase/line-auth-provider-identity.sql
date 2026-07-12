-- Hi Solar Tracker
-- LINE auth provider identity migration
-- Forward-only migration: switch app_users identity from
-- (line_channel_id, line_user_id) to (provider_namespace, line_user_id)
-- for a single shared LINE Login channel across Hi Solar and JDK.

begin;

alter table public.app_users
  add column if not exists provider_namespace text;

update public.app_users
set provider_namespace = 'hisolar-tracker-line'
where provider_namespace is null
   or btrim(provider_namespace) = '';

alter table public.app_users
  alter column provider_namespace set default 'hisolar-tracker-line';

do $$
declare
  duplicate_count integer := 0;
  duplicate_report text := '';
begin
  select count(*)
    into duplicate_count
  from (
    select line_user_id
    from public.app_users
    where provider_namespace = 'hisolar-tracker-line'
    group by line_user_id
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    select string_agg(
      format(
        'line_user_id=%s rows=%s app_user_ids=[%s] channel_ids=[%s]',
        duplicate.line_user_id,
        duplicate.row_count,
        duplicate.app_user_ids,
        duplicate.channel_ids
      ),
      E'\n'
      order by duplicate.line_user_id
    )
      into duplicate_report
    from (
      select
        u.line_user_id,
        count(*) as row_count,
        string_agg(u.id::text, ', ' order by u.created_at, u.id::text) as app_user_ids,
        string_agg(distinct coalesce(u.line_channel_id, '<null>'), ', ' order by coalesce(u.line_channel_id, '<null>')) as channel_ids
      from public.app_users u
      where u.provider_namespace = 'hisolar-tracker-line'
      group by u.line_user_id
      having count(*) > 1
    ) as duplicate;

    raise exception using
      errcode = '23505',
      message = 'Duplicate app_users rows block provider namespace identity migration',
      detail = coalesce(duplicate_report, 'Duplicate rows exist but could not be formatted.'),
      hint = 'Manually consolidate each duplicate LINE user into one app_users row before rerunning supabase/line-auth-provider-identity.sql. This migration does not auto-merge ambiguous identities.';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_users'
      and column_name = 'provider_namespace'
      and is_nullable = 'YES'
  )
  and not exists (
    select 1
    from public.app_users
    where provider_namespace is null
       or btrim(provider_namespace) = ''
  ) then
    alter table public.app_users
      alter column provider_namespace set not null;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'app_users_line_identity_key'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      drop constraint app_users_line_identity_key;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_provider_identity_key'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_provider_identity_key
      unique (provider_namespace, line_user_id);
  end if;
end;
$$;

create index if not exists app_users_provider_namespace_idx
  on public.app_users (provider_namespace);

comment on column public.app_users.provider_namespace is
  'Stable identity namespace for shared LINE Login within Hi Solar Tracker.';

comment on column public.app_users.line_channel_id is
  'Metadata only. Stores the LINE Login channel ID used at the time of login and is not part of the canonical identity key.';

commit;
