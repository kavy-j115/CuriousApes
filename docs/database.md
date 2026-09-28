# Database

Postgres, hosted on Supabase, accessed via the connection pooler
(direct connection is IPv6-only and unreachable from most home networks —
see docs/setup.md).

## Schema versioning

Every schema change is a numbered `.sql` file in `sql/` (e.g.
`001_initial_schema.sql`). `scripts/migrate.py` applies any file not yet
recorded in the `schema_migrations` table — so it's safe to re-run, and
running it after adding `002_....sql` only applies what's new. This is
intentionally simple (no Alembic/rollback support) — sufficient for one
developer during active development; revisit if that changes.

## Tables so far

### `clients`
One row per brand this agency manages. `client_id` is a short, stable
slug (e.g. `acme`) that matches the corresponding `config/clients/<id>.yaml`
file. Every other table that holds brand-specific data references this via
a foreign key, so an ingestion bug can never silently write data under a
brand that doesn't exist.

### `raw_shopify_orders`
Landing zone for Shopify order data, unmodified — the "raw layer" from
docs/architecture.md. Stores the full API response as JSONB rather than
individual columns: Shopify's order object has ~80 nested fields, and we
don't want to guess upfront which ones matter. Structured columns get
pulled out of this JSON during transformation (Milestone 5), once we know
what we actually need.

`UNIQUE (client_id, shopify_order_id)` makes re-fetching the same order
safe — re-running ingestion won't create duplicates, and order #1001 for
two different brands are correctly treated as different rows.

## Not built yet

Dimension/fact tables (`dim_date`, `fact_orders`, etc.) and clean/normalized
tables come later, once real Shopify data is flowing in and we know its
actual shape — see docs/architecture.md's raw -> clean -> analytics layering.
