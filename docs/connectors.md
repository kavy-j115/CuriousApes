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
- **Date window:** `fetch_orders(..., created_at_min=...)` accepts a date or
  ISO timestamp and filters server-side (`query: "created_at:>=..."`, sorted
  by creation). The daily run re-fetches the last N days of orders by
  *creation date*, so each run covers exactly the order dates asked for and
  matches what Shopify's own reports show. An earlier version filtered on
  `updated_at`, which pulled in old orders that had merely changed recently
  and left older days only partly filled -- misleading, so it was dropped.
  Trade-off: a refund/cancellation on an order older than the window isn't
  picked up until a run's window covers that order's date again.

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
(`analyticsdata.googleapis.com`, `runReport`).

**Credential is shared across every client, not per-client** — same
reasoning as Meta's `agency.meta_ads.access_token` (see docs/secrets.md).
The service account's identity never changes; only *which* GA4 properties
have granted it Viewer access changes per client. Onboarding a new
client's GA4 access needs zero new credentials: they add the shared
service account's email as a Viewer on their property (copy-paste, no
API/token knowledge required), the agency adds their `property_id` to
config.

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

### Testing status: verified live

Originally built with zero live verification (documented API behavior
only), since resolved. Getting there took two real dead ends worth
recording, since they're not obvious in advance:

- **Google's public GA4 demo account (Google Merchandise Store) turned
  out to be a dead end for this, for two separate reasons.** First,
  Viewer-only access (the only access level a normal person gets by
  adding the demo account) can't grant *anyone else* — including a
  service account — access to it; "Property Access Management" doesn't
  even appear as an option for a Viewer, not just error when tried.
  Second, even querying it directly via Google's own official Query
  Explorer tool (using a personal login, not our service account) hit a
  `429`: `"This property is denied access to the API"` — a shared quota
  on Google's side, since countless developers worldwide hit this same
  public demo property through tutorials and tools just like this one.
  Neither issue was something to work around; both meant abandoning the
  demo account entirely.
- **Fix: a real, self-created GA4 property.** Since you're the owner,
  Property Access Management actually works, and there's no shared-quota
  problem on a private property nobody else is querying.

**Verified directly against this real property** (property ID
`556836826`, zero real traffic — correctly returns 0 rows, not an error):
authentication (the service account JWT flow actually works), the real
HTTP request/response cycle, and `fetch_daily_ecommerce_metrics()`'s full
path with no exceptions. Also verified as part of the full orchestrator
run (`src/scheduler/run_pipeline.py`), alongside Shopify and Meta in the
same run — GA4 sync now shows `[OK]` like every other configured source. 
