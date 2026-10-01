# UI (web/)

Next.js (App Router, TypeScript) reading directly from Supabase.

## Why this stack

Target deployment is Netlify, for team-wide access with login. Netlify
hosts static sites and short-lived serverless functions — it cannot run a
persistent Python server, which ruled out Streamlit (our first instinct,
since everything else in this project is Python). Next.js + Supabase is the
stack that actually satisfies "deployed on Netlify" + "team login" without
a compromise on either.

This does **not** change the Python pipeline. It keeps writing to Postgres
exactly as before — the UI is just another reader of that same data, which
is the entire point of the dashboard-agnostic architecture from
docs/architecture.md.

## How it talks to the database

Two different connection paths exist in this project, intentionally:

- **Python (`DATABASE_URL`)** — a direct Postgres connection. Full access,
  server-side only, never exposed to a browser.
- **Next.js (`NEXT_PUBLIC_SUPABASE_URL` + anon key)** — goes through
  Supabase's API layer instead of talking to Postgres directly. The anon
  key is designed to be shipped to the browser, but that's only safe once
  Row Level Security (RLS) policies exist on every table.

RLS policies now exist on every client-scoped table (`sql/011_auth_and_rls.sql`,
see docs/auth.md) — the anon key can only read what the logged-in user's
role and `client_access` rows actually permit, verified directly via
`scripts/verify_rls.py`.

Gotcha hit while setting this up: Supabase's dashboard shows a project
*display name*, which is not the same as the URL's hostname (the actual
hostname uses the project's `ref`, a random string — visible in
`DATABASE_URL` and decodable from the anon key's JWT payload). Pasting the
display name in as the URL silently breaks every request with a generic
"fetch failed" error.

## Login: three themed forms, one real authorization check

`src/app/login/page.tsx` is a selector screen (Client/User/Admin), each
leading to `src/app/login/[role]/page.tsx` — a themed form (icon/color/copy
per role, see `src/lib/roleTheme.ts`). **Which button someone clicks is
cosmetic only.** The actual role comes from a fresh `user_profiles` lookup
in `src/app/login/actions.ts` after `signInWithPassword` succeeds; if it
doesn't match the button clicked, the session is torn down
(`supabase.auth.signOut()`) and a role-specific error is shown ("This is
not an admin account.") rather than silently granting access. This matters
because the three-button design is a genuine UX nicety, not a real access
gate — treating it as one would mean a `client` account could just click
"Admin Login" and get in with their own correct password.

## Dashboard shell (`src/app/dashboard/`)

`layout.tsx` is shared across every dashboard page: looks up the caller's
`Profile` (role + display name, via `src/lib/auth/profile.ts`, itself
relying on `user_profiles`' own "users see their own profile" RLS policy —
no service role needed), fetches the `clients` list (already correctly
scoped per role by RLS, no branching needed), and renders `Sidebar` +
`TopBar` around whatever page is active.

- **`Sidebar`** — nav items filtered by role from `_components/nav.ts`
  (`MAIN_NAV`/`ADMIN_NAV`, each item tagged with which roles see it).
  Segments and Cleaning & Download are admin/user only — hidden from
  `client` entirely, not just disabled, since a brand owner shouldn't be
  exporting their own customer PII or triggering a cleaning action. This
  is a UI nicety, not the real boundary: each of those pages also asserts
  its own role server-side (`assertRole()`), and the underlying data is
  RLS-protected regardless of what the sidebar shows.
- **`TopBar`** — `ClientDropdown` (admin/user only; hidden for `client`
  since RLS already limits them to exactly one client — a one-option
  dropdown would misleadingly imply a choice) and `ProfileMenu` (display
  name, role badge, log out).
- **Retention** is a plain external link (`NEXT_PUBLIC_RETENTION_DASHBOARD_URL`),
  not a page in this app — per docs/architecture.md's existing commitment
  not to touch the pre-existing retention dashboard unless asked.

Every dashboard page reads the selected client from `?client=` (defaulting
to the first client the role can see) — the same pattern the old
single-page dashboard used, just spread across multiple routes now instead
of one page's `?tab=`.

### Reports (`dashboard/reports/`)

What used to be the single page's **Report** + **Visualizations** tabs,
now one route with a `?view=table|chart` toggle. Reads
`daily_report_metrics`, filtered by `?client=`/`?from=`/`?to=`.
`from == to` (or `to` omitted) shows that one day's row with no Total row;
a genuine range adds a Total row using the same weighted-ratio math as the
Excel report (`src/lib/reportMath.ts`).

### Comparisons (`dashboard/comparisons/`)

The old **Compare** tab, unchanged in behavior — pick Period A and Period
B as independent date ranges, see both totals side by side with delta and
delta %, via `src/app/CompareView.tsx` reusing `computeTotal()`. Verified
against real data previously (3 orders/$300 vs. 2 orders/$500 produced the
expected -33.3%/+66.7%/+150.0% deltas); unchanged math, just relocated.

`?from=`/`?to=` filter live against current data, not a frozen historical
snapshot — if source data is edited later, the report reflects the update.
Snapshotting was considered and deliberately deferred; revisit if "what did
we report on day X" ever needs to survive a later data correction. `from
== to` (or `to` omitted) shows exactly that one day's row with no Total
row; a genuine range adds a Total row using the same weighted-ratio math
as the Excel report (`src/lib/reportMath.ts`, shared with the Compare tab).

### Compare tab

Built for comparing before/after periods around an incrementality test
(pick Period A and Period B as independent date ranges, see both periods'
totals side by side with the delta and delta %). `src/app/CompareView.tsx`
reuses `computeTotal()` from `src/lib/reportMath.ts` — the same weighted
math, run twice and diffed, rather than separate comparison logic.
MTD/LMTD are excluded from this view (they're calendar-month-cumulative
concepts, meaningless for an arbitrary comparison range). Verified against
real data inserted into a throwaway client: 3 orders/$300 (Period A) vs.
2 orders/$500 (Period B) produced exactly the expected deltas
(-1 order/-33.3%, +$200/+66.7% revenue, +$150/+150.0% AOV).

## AI on the dashboard (removed, revisit later)

A floating "Ask AI" button (popup window to claude.ai) was tried and
removed — the actual want was AI genuinely inline on the dashboard, not a
separate window. True inline embedding isn't achievable: `curl -sI
https://claude.ai` confirmed `X-Frame-Options: SAMEORIGIN` (blocks
`<iframe>` embedding outright), and even proxying their site through our
own domain would render broken (their CSP ties script execution to
per-request nonces scoped to their exact domain) and would likely violate
their terms of service — not something to build around.

The only real path to AI genuinely on the dashboard is our own chat panel
calling the Anthropic API directly (Milestone 10 territory, real
per-token cost) — deferred for now, to revisit later.

## Not built yet

**Dashboard home** (`dashboard/page.tsx`) has real stat tiles (revenue,
customers, orders, AOV, retention rate, repeat customers — the retention/
repeat figures come from `customer_ltv`/`cohort_retention`, see
docs/metrics.md) and reuses the existing revenue/orders chart, but hasn't
been visually refined beyond matching the reference mockup's layout.

Everything else in the sidebar beyond Dashboard/Reports/Comparisons/
Segments is a styled **"Coming soon" stub** with a real role gate already
in place (`assertRole()`), not yet real functionality:
Cleaning & Download (ties to the still-unbuilt data quality checks), Other
Features (Alerts + AI daily report both have working backends already,
just no UI view), and the admin-only Clients/Users/Permissions/Data
Sources/System Settings pages (the Users page in particular is where the
"collab" multi-client assignment feature will eventually live).

Netlify deployment is still deferred — see project roadmap.
