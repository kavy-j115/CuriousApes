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

**Current state: no RLS policies exist yet.** The anon key can read
everything. This is acceptable for local development only. Before any
public or team deployment, RLS + Supabase Auth (login) must be added
together — see the roadmap.

Gotcha hit while setting this up: Supabase's dashboard shows a project
*display name*, which is not the same as the URL's hostname (the actual
hostname uses the project's `ref`, a random string — visible in
`DATABASE_URL` and decodable from the anon key's JWT payload). Pasting the
display name in as the URL silently breaks every request with a generic
"fetch failed" error.

## Pages

One page, `src/app/page.tsx` — originally split into a plain "dashboard"
and a separate "/report" route, consolidated once it became clear the
dashboard's table was just a subset of the Business Health Report's data
(both ultimately read Shopify's numbers; `daily_report_metrics` is the
superset once Meta/GA4 are blended in). Two views of the same underlying
question didn't need two pages.

The single page reads `daily_report_metrics` (not `daily_business_metrics`
directly), filtered by `?client=`, `?date=`, and switches between a
**Report** (table) and **Visualizations** (charts, via Recharts) view via
`?tab=`, rendered as pill-style tabs using plain `<Link>`s — no client-side
JS needed for the switch itself, since each tab is just a different URL the
Server Component re-renders for.

`src/app/ReportControls.tsx` is a Client Component (`"use client"`) that
updates `client`/`date` search params via `next/navigation`'s `useRouter` —
the standard App Router pattern for "a control that changes what data the
server fetches." The client picker only renders once there are 2+ clients
(pointless UI for a single option); the date picker only applies to the
Report tab (a single-date filter doesn't mean much for a trend chart).

`?date=` filters to exactly that one day's row (a **live** query against
current data, not a frozen historical snapshot — if source data is edited
later, the report reflects the update). Snapshotting was considered and
deliberately deferred; revisit if "what did we report on day X" ever needs
to survive a later data correction.

## Not built yet

RLS policies, Supabase Auth (login), Netlify deployment. Deliberately
deferred until we're ready to actually hand this to the team — see
project roadmap.
