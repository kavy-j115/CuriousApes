# Architecture

## Mental model

```
API (Shopify, Meta, ...)
     |
     v
Python (ingestion) — fetches data, does nothing clever with it yet
     |
     v
PostgreSQL (raw layer) — stored exactly as the platform gave it to us
     |
     v
Python/SQL (transformations) — cleaned, standardized, deduplicated
     |
     v
PostgreSQL (analytics layer) — business metrics: revenue, AOV, CAC, ROAS...
     |
     +----------------+----------------+
     v                v                v
   Excel          AI Analyst      Future dashboards
   (report)     (interpretation)  (Power BI, Metabase,
                                   the existing retention
                                   dashboard, ...)
```

## Why layers, not one big script

Each arrow above is a place a future version of us can swap one thing without
touching the others:

- Swap Shopify's API version without touching how metrics are calculated.
- Recalculate a metric's formula without re-fetching data from the API.
- Add a new report format (or a new dashboard) without re-doing any of the above.

This is the classic **ETL/ELT** shape (Extract from the API, Load the raw
data, Transform it into something useful) — explained properly when we build
the first real ingestion job in Milestone 3-4.

## Why PostgreSQL is the center, not Excel

Excel is a *reporting surface* — something a human opens to read numbers.
It is not built to be queried, joined across brands, or connected to
simultaneously by multiple tools. PostgreSQL is the **single source of
truth**; Excel, the AI analyst, and any future dashboard all read *from* it,
they never store their own separate copy of the truth.

## Multi-brand from day one

Because this platform serves multiple agency clients, not one brand, every
table in the analytics layer carries a `client_id` (or `brand_id`) column,
and every per-brand credential/config lives in `config/clients/<brand>.yaml`
rather than in code or a single global `.env`. We are **not** building
full multi-tenant infrastructure (separate databases per client, tenant
routing, etc.) yet — just avoiding schema decisions that would make that
painful to add later. See Milestone 15 in the roadmap for when that gets
revisited properly.

## Dashboard-agnostic by design

The existing retention dashboard, and any future BI tool, should be able to
read from PostgreSQL views in the analytics layer without us rebuilding
anything. We will not modify the retention dashboard unless explicitly asked.

## Future work: a real Shopify OAuth app

Onboarding currently needs a client to manually create a custom app in
their own Shopify admin and hand us a token — the only credential in this
project that still requires a human on the client's side to understand
what an API token is (Meta was simplified away from this, see
docs/secrets.md; GA4 never had this problem, since it only needs the
client to grant our service account's email Viewer access).

The real fix is a proper Shopify **OAuth app**: the client clicks one
install link, sees Shopify's own permission screen, clicks Install — the
access token then flows directly server-to-server between Shopify and us,
with no copying involved at all. This is a genuinely bigger build than
everything else in this list (needs a public HTTPS OAuth callback
endpoint, Partner Dashboard app configuration, CSRF/`state` handling) and
is coupled to having a real deployed URL — worth doing before onboarding
many real clients, but deliberately scoped as its own project rather than
squeezed in alongside smaller changes.

## Roadmap

See project milestones (tracked in conversation / project board) — in short:
Environment -> Postgres -> Shopify connector -> Shopify pipeline -> Analytics
-> Excel -> Scheduling -> Meta Ads -> Unified analytics -> AI analyst ->
Alerts -> More platforms -> Dashboard integrations -> Advanced analytics ->
Multi-client hardening.
