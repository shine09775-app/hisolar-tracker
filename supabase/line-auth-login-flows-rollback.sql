-- Rollback for line-auth-login-flows.sql
-- Deploy the previous app code first: the callback and poll endpoints read this table.
drop table if exists public.auth_login_flows;
