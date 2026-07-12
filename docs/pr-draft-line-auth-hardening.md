# Draft PR Description: LINE-Authenticated Tracker Hardening

## Summary

This PR hardens the Hi Solar tracker around authenticated LINE Login access, organization-scoped authorization, authenticated Supabase browser access, and safer mobile/job interactions.

The branch is intended for GitHub review and Vercel Preview verification only.

Production cutover is explicitly **not** included in this PR. Do **not** run `supabase/line-auth-cutover.sql` until live verification passes.

## What Changed

### Authentication and session flow

- Added LINE Login backend endpoints:
  - `GET /api/auth/line/start?app=hisolar|jdk`
  - `GET /api/auth/line/callback`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
  - `GET /api/auth/token`
- Added PKCE, state, nonce, signed flow cookies, opaque session cookies, and short-lived Supabase JWT issuance.
- Removed browser identity selection based on PIN/localStorage.

### Frontend gating

- `index.html` is now the Hi Solar login entry only.
- `hisolar_planner.html` authenticates before loading data or starting Realtime.
- `JDK.html` authenticates before loading data or starting Realtime.
- JDK users do not get a status update path in the frontend.

### Database and RLS foundation

- Added additive LINE auth foundation migration.
- Added provider-namespace identity migration for shared LINE Login.
- Added organization-scoped RLS migration so JWT `organization` must match DB membership checks.
- Added rollback SQL companions for cutover-sensitive migrations.

### Comments, maps, phone

- Comment identity is sourced from authenticated user context and DB snapshot columns.
- Maps links are sanitized and deny-by-default if helper code is unavailable.
- Phone links normalize to safe `tel:` output and malformed values are rejected.

### Regression coverage

- Added automated tests for:
  - no browser anon Supabase client
  - auth bootstrap ordering
  - dual-membership RLS behavior
  - maps fallback safety
  - cutover preflight checks
  - comment identity overwrite expectations

## Database Migration Order

1. `supabase/schema.sql`
2. `supabase/line-auth-foundation.sql`
3. `supabase/line-auth-provider-identity.sql`
4. `supabase/line-auth-org-scope.sql`
5. `supabase/line-auth-cutover.sql` only after live production verification and explicit approval

## Testing

- `npm.cmd test`
- preflight cutover test suite
- browser-anon regression tests
- auth/session/token flow unit tests
- RLS org-scope behavior-model tests
- maps/tel/comment identity regression tests

## Not Included

- Production cutover execution
- Production SQL execution
- Removal of anon policies in the current environment
- Live-user validation evidence

## Review Focus

- LINE Login server-side security flow
- Supabase JWT and RLS organization scoping
- Comment identity enforcement
- JDK scope restrictions
- Safe handling of maps and phone actions
- Migration order and rollback readiness

## Merge / Deploy Notes

- Keep Vercel `Production Branch` on `main`
- Use this PR for Preview verification first
- Do not merge until live verification checklist is completed
- Do not run `supabase/line-auth-cutover.sql` until all readiness checks pass
