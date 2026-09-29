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

## Meta Ads

`src/connectors/meta_ads.py` — talks to the **Marketing API**'s Ads Insights
endpoint (`/act_{ad_account_id}/insights`).

Key mechanics:
- **Auth:** a Business Manager **System User** token (Business Settings →
  Users → System Users), not a normal OAuth user token. A user token expires
  in ~60 days and needs a human to re-authenticate; a System User token can
  be set to never expire, which is what an unattended scheduled job needs.
- **Pagination:** a full "next" URL returned in the response's `paging`
  object — different again from Shopify's cursor-token style. We just follow
  the URL Meta gives us rather than constructing the next request ourselves.
- **Rate limiting:** usage percentage reported in the
  `x-business-use-case-usage` response header; the connector backs off if
  any metric in it is above 90%.
- **The `actions` field is not fixed columns.** Meta returns a list like
  `[{"action_type": "purchase", "value": "12"}, ...]` rather than a
  `purchases` field directly. `extract_action_metric()` pulls one specific
  `action_type` out of that list. Which exact string means "a real purchase"
  can vary by how a client's pixel is configured (`purchase` vs
  `omni_purchase` vs `offsite_conversion.fb_pixel_purchase` all show up in
  practice) — we default to `purchase` and expect to adjust this per-client
  once real data is flowing.

### Testing limitation (documented honestly, not hidden)

Unlike Shopify's Bogus Gateway, a Meta test ad account does not generate
realistic delivery data — no real audience sees test ads, so insights come
back empty. This means:
- **Verified live:** authentication, request construction, and pagination
  (confirmed against a real test ad account — correctly returns zero rows,
  no errors).
- **Verified only against synthetic data:** `extract_action_metric()`'s
  parsing logic, checked against a hand-built example shaped like Meta's
  documented response format, not live data.

This gap closes the same way the Shopify gap would have if we'd used a
sandbox with no test orders: once real (even read-only) ad account data is
available, this is the first thing to re-verify.
