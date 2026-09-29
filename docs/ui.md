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

`src/app/page.tsx` — a Server Component (`async function`, runs only on
the server) that queries `daily_business_metrics` and `clients`, filtered
by a `?client=` URL search param. `src/app/ClientPicker.tsx` is a small
Client Component (`"use client"`) that updates that search param via
`next/navigation`'s `useRouter` — the standard App Router pattern for
"a control that changes what data the server fetches."

## Not built yet

RLS policies, Supabase Auth (login), Netlify deployment. Deliberately
deferred until we're ready to actually hand this to the team — see
project roadmap.
