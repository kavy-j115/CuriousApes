# Connectors

## Shopify

`src/connectors/shopify.py` — talks to the Admin **GraphQL** API
(`/admin/api/2024-10/graphql.json`). REST was intentionally not used: Shopify
declared REST "legacy" in Oct 2024 and isn't extending it further.

Key mechanics:
- **Auth:** `X-Shopify-Access-Token` header, one token per store (custom app,
  store-scoped — not the Partner Dashboard's distributable-app OAuth flow).
- **Pagination:** cursor-based. Each page's `pageInfo.endCursor` is passed as
  `after` on the next request; `pageInfo.hasNextPage` tells us when to stop.
- **Rate limiting:** cost-based, not request-count-based. Every response
  includes `extensions.cost.throttleStatus`; the connector backs off with a
  short sleep when the remaining bucket gets low, rather than guessing a
  fixed delay.
- **Incremental sync hook:** `fetch_orders(..., updated_at_min=...)` accepts
  an ISO timestamp and filters server-side (`query: "updated_at:>=..."`).
  Not used yet — wired up when we build the daily sync job — but built in
  now since retrofitting it later would mean redesigning the function
  signature after other code already depends on it.

`src/ingestion/shopify_orders.py` calls the connector and **upserts** into
`raw_shopify_orders` (insert, or overwrite `raw_data` if the row already
exists). This makes reruns always safe — whether it's a first backfill or a
sync that partially failed and gets retried.

### Testing without touching real client data

We test against a free Shopify **development store** (Partner Dashboard →
Stores → Add store), with orders placed manually via the built-in "Bogus
Gateway" test payment processor. This gave us real order JSON shapes to
build and verify against before this connector ever touches a real client's
store.
