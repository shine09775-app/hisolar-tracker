# Vercel Preview Live Verification Checklist

Use this checklist on the Vercel Preview deployment for branch `codex/line-auth-tracker-hardening`.

## Rules

- Do not merge to `main` during this checklist.
- Do not run `supabase/line-auth-cutover.sql` during this checklist.
- Use the existing Supabase project.
- Record exact tester names, LINE accounts, timestamps, and screenshot/video evidence.

## Preconditions

- Vercel Preview is built from branch `codex/line-auth-tracker-hardening`
- Preview environment variables are set for shared LINE Login and Supabase server-side auth
- Supabase additive migrations already applied:
  - `supabase/line-auth-foundation.sql`
  - `supabase/line-auth-provider-identity.sql`
  - `supabase/line-auth-org-scope.sql`
- At least 5 test users are ready:
  - Hi Solar approved user A
  - Hi Solar approved user B
  - JDK approved user A
  - JDK approved user B
  - dual-membership approved user
- At least 2 extra test states are ready:
  - pending user
  - suspended user

## Evidence Header

- Preview URL:
- Commit SHA:
- Test date:
- Testers:
- Supabase project ref:

## A. Hi Solar real-user checks

- [ ] User A can open `index.html`
- [ ] User A can login with LINE and is redirected to `hisolar_planner.html`
- [ ] User A can read jobs
- [ ] User A can create/update a permitted Hi Solar job action
- [ ] User A can add a comment
- [ ] User B sees User A comment via Realtime without manual refresh
- [ ] Header shows LINE display name, avatar, and role correctly

## B. JDK real-user checks

- [ ] User A can open `JDK.html`
- [ ] User A can login with LINE and stay within JDK scope
- [ ] User A can read only JDK-visible sheets
- [ ] User A cannot access Hi Solar-only workflow from the UI
- [ ] User A can add a comment on visible jobs only
- [ ] User B sees User A comment via Realtime without manual refresh
- [ ] Header shows LINE display name and avatar correctly

## C. Membership state checks

- [ ] pending user is redirected to pending state and cannot use app data
- [ ] suspended user is denied after auth/session check
- [ ] wrong-app user gets denied for the other app

## D. Dual-membership checks

- [ ] dual-membership user can use Hi Solar when app context is `hisolar`
- [ ] dual-membership user can use JDK when app context is `jdk`
- [ ] JDK-authenticated token cannot update Hi Solar job status through direct REST
- [ ] JDK-authenticated token cannot read permits through direct REST

## E. Navigation and access checks

- [ ] direct visit to `index.html` behaves correctly for anonymous and authenticated Hi Solar users
- [ ] direct visit to `hisolar_planner.html` without session does not show data and returns to login flow
- [ ] direct visit to `JDK.html` without session does not show data before auth

## F. Token / session checks

- [ ] logout clears session and returns to login entry
- [ ] expired session returns to login/expired state cleanly
- [ ] token refresh succeeds during active usage
- [ ] temporary network failure shows safe error state and no unauthorized data flash

## G. Maps / phone / comment identity

- [ ] valid Google Maps links render and open correctly
- [ ] invalid maps URL does not render a Maps button
- [ ] edit form rejects invalid maps URL and cannot save it
- [ ] valid phone values produce correct `tel:` behavior on mobile
- [ ] malformed phone values do not render a call button
- [ ] new comments show avatar, display name, organization, timestamp, and escaped text

## H. Secrets / source checks

- [ ] Preview page source does not contain service-role key, LINE secret, JWT private key, or session secret
- [ ] Browser network responses do not expose LINE access tokens or private signing material
- [ ] Server logs used during test do not print secrets

## I. Known non-pass items before cutover

These are expected to remain open until the explicit cutover window:

- [ ] anonymous REST read/write is denied only after `supabase/line-auth-cutover.sql`

Do not mark production ready until this item is re-tested in the cutover window.

## Exit Criteria

Mark Preview verification complete only if:

- All sections A-H pass
- Evidence is captured
- No unexpected access path is found
- No secret exposure is found

If any item fails:

- Stop
- Do not merge to `main`
- Do not run `supabase/line-auth-cutover.sql`
- Fix issue, redeploy Preview, and rerun checklist
