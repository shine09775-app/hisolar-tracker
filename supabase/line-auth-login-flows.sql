-- Hi Solar Tracker
-- LINE Login: server-side login attempts
--
-- The flow cookie only lives in the browser that pressed "เข้าสู่ระบบด้วย LINE".
-- On iPhone the LINE app often hands the callback to a different browser
-- (LINE's in-app browser, Safari, or out of the home-screen app), so the
-- callback could not find the cookie and showed "Login attempt is missing or
-- expired". Keeping the attempt here lets the callback finish in any browser,
-- and lets the home-screen app pick up the finished login (handoff).
--
-- Holds PKCE verifiers: service role only, no anon/authenticated policies.

create table if not exists public.auth_login_flows (
  state_hash text primary key,
  app text not null,
  return_to text,
  nonce text not null,
  code_verifier text not null,
  handoff_hash text,
  used_at timestamptz,
  completed_user_id uuid references public.app_users(id) on delete cascade,
  completed_outcome text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint auth_login_flows_app_check
    check (app in ('hisolar', 'jdk')),
  constraint auth_login_flows_outcome_check
    check (completed_outcome is null or completed_outcome in ('approved', 'pending'))
);

create unique index if not exists auth_login_flows_handoff_hash_key
  on public.auth_login_flows (handoff_hash)
  where handoff_hash is not null;

create index if not exists auth_login_flows_expires_at_idx
  on public.auth_login_flows (expires_at);

alter table public.auth_login_flows enable row level security;
revoke all on public.auth_login_flows from anon, authenticated;
