# D2C Data Automation & AI Analytics System

A data platform for a marketing agency running multiple D2C brands: pulls data from
Shopify, Meta Ads, Google Ads, GA4 and other platforms into a central PostgreSQL
database, turns it into clean business metrics, and produces Excel reports and
AI-generated insights — without locking us into one dashboard tool.

Built brand-by-brand: each client's store/ad-account config lives in
`config/clients/`, so onboarding a new brand is "add a config file," not
"change code."

Status: **Milestone 0 — environment & project foundations.**
See [docs/architecture.md](docs/architecture.md) for the system design and
[docs/setup.md](docs/setup.md) for how to get this running locally.

## Project layout

```
config/           per-brand config (YAML), non-secret settings
config/clients/   one file per brand: store domain, ad account IDs, etc.
src/connectors/   talk to external APIs (Shopify, Meta, ...) — auth + raw requests
src/ingestion/    pulls data via connectors, writes it into the raw database layer
src/transformations/  cleans/normalizes raw data into consistent tables
src/analytics/    computes business metrics (revenue, AOV, CAC, ROAS, ...)
src/database/     connection handling, schema/migrations
src/reports/      generates Excel/BI-facing output
src/ai/           LLM-based interpretation of the analytics layer
src/scheduler/    runs the pipeline on a schedule
sql/              raw SQL: schema definitions, views
tests/            automated tests
docs/             architecture & concept documentation (how + why)
scripts/          one-off / operational scripts
```

## Setup

See [docs/setup.md](docs/setup.md).
