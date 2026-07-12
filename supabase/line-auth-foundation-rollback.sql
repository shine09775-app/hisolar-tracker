-- Hi Solar Tracker
-- LINE auth database foundation rollback
-- Removes only the additive objects introduced by line-auth-foundation.sql.
-- Existing anon policies and legacy tables remain untouched.

drop policy if exists "Authenticated read permit logs hisolar admin member" on public.hi_solar_permit_logs;
drop policy if exists "Authenticated insert permit logs hisolar admin member" on public.hi_solar_permit_logs;
drop policy if exists "Authenticated read permits hisolar admin member" on public.hi_solar_permits;
drop policy if exists "Authenticated insert permits hisolar admin member" on public.hi_solar_permits;
drop policy if exists "Authenticated update permits hisolar admin member" on public.hi_solar_permits;
drop policy if exists "Authenticated read job logs by membership" on public.hi_solar_job_logs;
drop policy if exists "Authenticated read comments by visible job" on public.hi_solar_job_comments;
drop policy if exists "Authenticated insert comments by membership" on public.hi_solar_job_comments;
drop policy if exists "Authenticated read jobs by membership" on public.hi_solar_jobs;
drop policy if exists "Authenticated insert jobs hisolar admin member" on public.hi_solar_jobs;
drop policy if exists "Authenticated update jobs hisolar admin member" on public.hi_solar_jobs;
drop policy if exists "Authenticated read app_users self or org admin" on public.app_users;
drop policy if exists "Authenticated read app_memberships self or org admin" on public.app_memberships;
drop policy if exists "Authenticated insert app_memberships org admin" on public.app_memberships;
drop policy if exists "Authenticated update app_memberships org admin" on public.app_memberships;
drop policy if exists "Authenticated read access_requests self or org admin" on public.access_requests;
drop policy if exists "Authenticated insert access_requests self pending" on public.access_requests;
drop policy if exists "Authenticated update access_requests org admin" on public.access_requests;

drop trigger if exists hi_solar_job_comments_apply_actor_snapshot on public.hi_solar_job_comments;
drop trigger if exists access_requests_set_updated_at on public.access_requests;
drop trigger if exists app_memberships_set_updated_at on public.app_memberships;
drop trigger if exists app_users_set_updated_at on public.app_users;

drop function if exists public.apply_comment_actor_snapshot();
drop function if exists public.can_view_access_request(uuid, text);
drop function if exists public.can_view_membership(uuid, text);
drop function if exists public.can_view_user(uuid);
drop function if exists public.can_insert_comment(uuid);
drop function if exists public.can_read_job_log(uuid, text);
drop function if exists public.can_read_job(uuid);
drop function if exists public.can_read_job_sheet(text);
drop function if exists public.is_jdk_job_scope(text);
drop function if exists public.can_manage_organization(text);
drop function if exists public.has_membership_role(text, text[]);
drop function if exists public.is_active_membership(text);
drop function if exists public.current_request_organization();

drop index if exists public.access_requests_pending_user_org_key;
drop index if exists public.access_requests_requested_at_idx;
drop index if exists public.access_requests_user_org_status_idx;
drop index if exists public.auth_sessions_active_idx;
drop index if exists public.auth_sessions_expires_at_idx;
drop index if exists public.auth_sessions_app_idx;
drop index if exists public.auth_sessions_user_id_idx;
drop index if exists public.app_memberships_org_status_role_user_idx;
drop index if exists public.app_memberships_user_id_idx;
drop index if exists public.app_users_last_login_at_idx;
drop index if exists public.app_users_line_user_id_idx;
drop index if exists public.hi_solar_job_comments_actor_user_id_idx;
drop index if exists public.hi_solar_job_comments_organization_idx;

alter table public.hi_solar_job_comments
  drop constraint if exists hi_solar_job_comments_actor_user_id_fkey,
  drop constraint if exists hi_solar_job_comments_organization_check;

alter table public.hi_solar_job_comments
  drop column if exists actor_user_id,
  drop column if exists author_name_snapshot,
  drop column if exists author_picture_url_snapshot,
  drop column if exists organization;

drop table if exists public.access_requests cascade;
drop table if exists public.auth_sessions cascade;
drop table if exists public.app_memberships cascade;
drop table if exists public.app_users cascade;
