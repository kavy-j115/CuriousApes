# Auth & Row Level Security

## Status: database layer complete and verified. Next.js integration built and structurally verified; live login pending a real confirmed user.

Built during an autonomous session. The SQL side (the security-critical
half) is complete, tested, and passing. The Next.js session integration
was initially held back over version-drift risk (tool access was
intermittently unavailable early in the session), then completed once
tools stabilized and every version-sensitive detail could be verified
directly rather than assumed — including catching a real breaking change
along the way (see "A real version-drift catch" below).

**Immediate consequence, so it isn't a surprise tomorrow morning:** the
dashboard, as it exists right now, has no login flow yet — it queries
Supabase with the `anon` role. Now that RLS is enabled and no policy
grants `anon` anything, the live dashboard will show its "No data for
this selection" empty state on every page. This was verified directly
(`SET LOCAL role TO anon` returns 0 rows from every table) and is the
**correct, intended** security behavior, not a bug — the dashboard
degrades gracefully (an empty state, not a crash) rather than either
leaking data or breaking. Finishing the Next.js login integration is the
natural first task tomorrow, and will restore real data for logged-in
users.

## The role model (from earlier project notes)

- **admin** — agency owner/lead. Sees every client.
- **user** — a growth marketer. Scoped to whichever clients they're
  assigned to via `client_access` — a many-to-many table, since the
  planned "collab" feature means one marketer can be assigned to several
  clients over time.
- **client** — a brand owner. Scoped to exactly one client (same
  `client_access` table, just conventionally one row) — read access to
  their own data only.

## Schema (`sql/011_auth_and_rls.sql`)

`user_profiles` (one row per Supabase Auth user, holding their `role`) and
`client_access` (user_id, client_id pairs — the actual access grants).
RLS enabled on every client-scoped table: `clients`, `orders`,
`order_line_items`, `customers`, `raw_shopify_orders`, `raw_meta_insights`,
`raw_ga4_sessions`, `alerts`, `ai_daily_reports`. Each gets two permissive
SELECT policies (Postgres OR's multiple permissive policies together for
the same action): "is admin" and "has explicit client_access".

## Two real bugs caught by testing, not assumed away

**1. Views silently bypass RLS by default.** RLS policies live on
**tables**, not views — but almost everything this app queries is a
**view** (`daily_report_metrics`, built on `daily_business_metrics`,
`daily_meta_metrics`, `daily_ga4_metrics`). By default, a Postgres view
runs with the view **owner's** privileges, not the querying user's —
meaning RLS on the base tables would be silently bypassed for anyone
querying through the view, with no error; they'd just see everyone's
data. Fixed with `ALTER VIEW ... SET (security_invoker = true)` on every
view in the chain (confirmed supported: this project runs Postgres 17,
this feature exists since PG15).

**2. Infinite recursion in `user_profiles`' own policy.** The first draft
of the "admins see all profiles" policy queried `user_profiles` itself to
check the current user's role — which re-triggers that same table's RLS
policy, which queries it again, forever. Caught immediately by running
`scripts/verify_rls.py`, not by reasoning about the SQL — this class of
bug doesn't show up by reading the policy, only by executing it. Fixed
with the standard pattern: `is_admin()` and `has_client_access()`,
`SECURITY DEFINER` functions that run as their owner (bypassing RLS)
rather than the querying user, breaking the cycle. Every policy uses
these functions instead of a raw subquery against an RLS-protected table.

## Why the Python pipeline is unaffected

RLS does not apply to a table's **owner** by default, unless `FORCE ROW
LEVEL SECURITY` is explicitly set (this migration does not set it). The
Python pipeline connects via `DATABASE_URL` as the `postgres` role, which
owns these tables. **Confirmed, not assumed:** re-ran the full
orchestrator after enabling RLS — Shopify sync/transform/report
generation all succeeded exactly as before (the one failure in that run,
Meta's "API access blocked", is the pre-existing, already-diagnosed
account-side issue unrelated to this work).

## Verification (`scripts/verify_rls.py`)

Simulates 3 authenticated users (one per role) via `SET LOCAL role TO
authenticated; SET LOCAL request.jwt.claim.sub TO '<uuid>'` — the actual
mechanism PostgREST uses, confirmed by reading `auth.uid()`'s real
definition on this project via `pg_get_functiondef` before writing the
simulation, not assumed from generic Supabase docs. Two genuinely
distinct test clients (not just one, to actually prove cross-client
isolation) with their own order data. All 5 checks pass:
- admin sees both test clients
- a 'user' scoped to Client A sees only Client A, never Client B
- a 'client' scoped to Client B sees only Client B, never Client A
- isolation holds through the full `daily_report_metrics` view chain
  (the specific thing `security_invoker` was needed for)
- the `orders` base table is isolated independently of the view

All test data (fake `auth.users`/`user_profiles`/`client_access` rows,
two throwaway clients and their orders) is cleaned up unconditionally
after the run.

## The Next.js integration

`web/src/lib/supabase/server.ts` (Server Components — one new client per
request per `@supabase/ssr`'s own guidance), `web/src/lib/supabase/client.ts`
(Client Components), `web/src/proxy.ts` (refreshes the session on every
request; also redirects unauthenticated requests to `/login`), and a login
page (`web/src/app/login/`) with email+password sign-in via a Server
Action. No sign-up action exists deliberately — user provisioning is
admin-side (a `user_profiles`/`client_access` row created directly), not
self-service, matching the agency/client access model.

### A real version-drift catch, not just caution

**`middleware.ts` is deprecated in Next.js 16**, renamed to `proxy.ts`
(the exported function is now `proxy`, not `middleware`) — confirmed by
reading this project's own installed Next.js docs before writing anything.
Writing the file under its old, now-unrecognized name would have silently
done nothing — no session refresh, no route protection, no error either,
since Next.js simply wouldn't have picked the file up at all. This is
exactly the category of mistake the earlier caution about Next.js 16 was
about, and it was real, not hypothetical.

Also confirmed directly rather than assumed: `@supabase/ssr`'s cookie
methods must be `getAll`/`setAll` (the older `get`/`set`/`remove` are
deprecated, checked via the package's own type definitions), `getClaims()`
is the current recommended session check (over `getSession()`/`getUser()`),
and `next/headers`'s `cookies()` is `async` in this Next.js version (same
pattern as the `searchParams` change caught earlier in this project).

### Verified

- Type-checks clean (`npx tsc --noEmit`).
- An unauthenticated request to `/` redirects to `/login` (confirmed in
  browser — the proxy is actually running, not just present in the repo).
- `/segments` (a page that doesn't even use Supabase) is also correctly
  protected — the proxy applies to all routes by default, not an
  allowlist that could accidentally miss one.
- Login page renders correctly (email/password fields, submit button).

**Not verified: an actual successful login.** That needs a real,
email-confirmed user, which needs either the Supabase dashboard (a manual
"Add user" step with "Auto confirm" checked — about 30 seconds) or
`SUPABASE_SERVICE_ROLE_KEY` (not set yet) to create one via the Admin API.
Deliberately not hand-crafted directly in `auth.users` via SQL — that
table has enough internal Supabase/GoTrue invariants (password hashing
scheme, required metadata columns) that guessing at them risked a
confusing, hard-to-diagnose broken user rather than a clean test.

## Not built yet

- An actual successful login test (see above — needs your 30-second
  manual step or the service role key).
- Role-based UI filtering (the client picker already only shows what RLS
  returns, but no UI yet distinguishes admin/user/client visually or
  restricts the segment export tool by role).
- A real user-provisioning flow (currently: manually inserting
  `user_profiles`/`client_access` rows via SQL; a proper admin UI for
  this is future work).
- RLS for `INSERT`/`UPDATE`/`DELETE` — only `SELECT` policies exist,
  since the web app is currently read-only. Add write policies if/when
  the app gains any write functionality (e.g. the deferred segment
  write-back feature).
