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

## GA4

`src/connectors/ga4.py` — talks to the **GA4 Data API**
(`analyticsdata.googleapis.com`, `runReport`). Written by request, with no
GA4 property access set up yet — real credentials are being deferred until
account access is ready.

Key mechanics:
- **Auth:** a Service Account JSON key, not a simple bearer token like
  Shopify/Meta. Signing and refreshing the JWT this requires is genuine
  cryptography we don't want to hand-roll, so we use Google's official
  `google-auth` library for just that step — everything else in the
  connector is plain `requests`, same as our other connectors.
- **Response shape is positional, not keyed.** GA4 returns
  `dimensionValues`/`metricValues` as parallel arrays lined up with the
  `dimensions`/`metrics` you requested, not a dict with named fields —
  `_parse_row()` zips them back together ourselves.
- **Known simplification:** `addToCarts` and `checkouts` are GA4's raw
  *event counts*, not deduplicated *session counts*. One visitor can
  add an item to cart twice in the same session — GA4 would count that as
  2, but "Sessions with cart additions" (from the target report format)
  wants 1. Getting the true session-level count needs a second,
  differently-filtered GA4 query, which isn't built yet. Until it is, the
  numbers this connector produces for those two columns will run slightly
  high compared to true session counts.

### Testing status: unverified against a live account

This is the first connector in the project built entirely against
documented API behavior with **zero live verification** — no GA4 property
access exists yet. Everything else we've built (Shopify: fully verified
against real test orders; Meta: plumbing verified live, parsing verified
synthetically) had at least a live connectivity check. This one has:
- **Verified:** `_parse_row()`'s parsing logic, against a hand-built
  example shaped like GA4's documented response.
- **Not verified at all:** authentication (service account JWT flow),
  the actual API request/response cycle, error handling.

Treat this connector as higher-risk of needing a real fix, not just
re-verification, once credentials exist — unlike Shopify/Meta where the
live plumbing was already proven and only real-data edge cases remained.
