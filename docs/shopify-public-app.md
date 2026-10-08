# Shopify public app (one app for every store)

A custom-distribution app belongs to ONE store, which is why each new client store needed its own
app. A **public** app is one app that any store can install, so adding a client no longer needs a
new app in the Shopify Dev Dashboard. It needs Shopify's App Store review.

## What the code already does (built, tested without Shopify)

| Piece | Where |
|---|---|
| Install: authorize -> callback -> token stored in Vault | `web/src/app/api/shopify/install`, `.../callback` |
| **Expiring tokens** (access token ~1 h + refresh token ~90 days that rotates on every refresh) | callback stores a JSON pair when `SHOPIFY_EXPIRING_TOKENS=1`; `src/connectors/shopify_token.py` refreshes it in the pipeline, saves the new pair first, and takes a database lock so two runs never refresh the same store together |
| Plain (non-expiring) tokens of today's custom apps keep working unchanged | same module: a secret that is not JSON is returned as is |
| **Privacy webhooks** `customers/data_request`, `customers/redact`, `shop/redact` | `web/src/app/api/shopify/webhooks/route.ts` (HMAC-checked) |
| `app/uninstalled` -> the client is paused (sync off, data kept) | same route |
| Erasing a customer / a store | `redact_shopify_customer()` and `delete_client_completely()` (migrations 039, 029); log in table `privacy_requests` |
| Public pages the listing links to | `/privacy`, `/terms`, `/support` (drafts: have them reviewed before submitting) |

Nothing here writes to Shopify. The only non-read call is the OAuth token exchange (install and
refresh), which `scripts/check_read_only.py` lists explicitly.

## What you do in Shopify (not something code can do)

1. **Dev Dashboard -> Create app** (new app, e.g. "Curious Apes"), choose **Public distribution**.
2. **URLs**
   - App URL: `<site>/api/shopify/install`
   - Allowed redirection URL: `<site>/api/shopify/callback`
   - Use the legacy install flow (authorization code grant).
3. **Scopes**: `read_orders,read_customers,read_products,read_reports`. Request **protected customer
   data** access (names, emails, phones). For `read_all_orders` see the next section: do NOT put it in
   the app version until Shopify has approved it, or creating the version fails.
4. **Webhooks** (set in the app's configuration, not through the API):
   - Compliance: `customers/data_request`, `customers/redact`, `shop/redact` -> `<site>/api/shopify/webhooks`
   - `app/uninstalled` -> `<site>/api/shopify/webhooks`
5. **Listing**: name, description, icon, screenshots, **privacy policy URL** `<site>/privacy`, support
   URL `<site>/support`, emergency developer contact, and a **screencast** of installing and using it.
6. **Submit for review** and answer the reviewer. Public apps must use expiring tokens (required for
   new public apps since 1 April 2026), which is why that support was built first.

## Orders older than 60 days (`read_all_orders`)

Without this scope Shopify lets an app read only the **last 60 days** of orders. With it, any age, so a
new client can be backfilled for months or years through the bulk export.

1. Create the app with the four scopes above first.
2. Dashboard -> your app -> **API access requests** -> the "Read all orders scope" card -> **Request
   access**. Describe the app and why: reporting, retention analysis and customer segments for the
   store's marketing agency, which need the full order history.
3. **Wait for Shopify's approval.** Declaring the scope before approval makes creating an app version
   fail with an `app_access` error.
4. When approved: add `read_all_orders` (together with `read_orders`) in a new app version, release it,
   and set `SHOPIFY_SCOPES=read_orders,read_customers,read_products,read_reports,read_all_orders`
   in `web/.env.local` and Netlify so the install link asks for it.
5. A store that installed earlier does NOT get the new scope by itself: it has to approve the updated
   app (reinstall through the install link).

What the code does with it: at install, Shopify's answer lists the scopes granted; the callback sets
`clients.all_orders_access` (migration 040). For such a client the "Sync now" pop-up offers up to 5
years back (presets for 6 months, a year and everything) and the pipeline's history limit rises from
60 days to 1,825. Clients without the scope stay at 60 days exactly as before.

## Settings to change once the public app exists

| What | Where |
|---|---|
| New app's client ID | `SHOPIFY_CLIENT_ID` in `web/.env.local` and Netlify |
| New app's client secret | `venv/Scripts/python scripts/set_vault_secret.py agency.shopify.client_secret` (hidden prompt) |
| New app's client ID for the pipeline's refresh | `venv/Scripts/python scripts/set_vault_secret.py agency.shopify.client_id` |
| Turn on expiring tokens | `SHOPIFY_EXPIRING_TOKENS=1` in `web/.env.local` and Netlify |
| Public contact address on the policy pages | `NEXT_PUBLIC_SUPPORT_EMAIL` |

The stores already connected through their own custom apps keep their stored tokens and keep working.
A store is only moved to the public app when it is reinstalled through it.

## Open questions for the review

- **Embedded app:** Shopify may expect an App Store app to open inside the Shopify admin. Ours has no
  merchant screen yet. If the reviewer asks, the install route can show a small "connected" page
  inside the admin (that is a new, separate piece of work).
- **Who may install:** today the install route only accepts a store an admin has already added as a
  client ("Store not registered" otherwise). A reviewer installing on a test store would hit that.
  Options: auto-create a pending client (sync off until an admin approves), or keep the agency-only
  model and share the install link directly.
- **Listing visibility:** whether Shopify allows an unlisted public app (installed by link, not
  searchable) was not confirmed from its documentation.
