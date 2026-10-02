# Onboarding a client

Done entirely from the admin Clients page -- no config file, no git commit.

1. **Add the client** (client_id, display name, and whichever of: Shopify
   store domain, Meta ad account ID, GA4 property ID you have). Meta and GA4
   use the shared agency credentials; only Shopify needs a per-store token.
   A new client starts with **Sync off** -- nothing is fetched from any API
   until it's switched on.
2. **Connect Shopify**: open the client's "connections" panel, click
   *Connect Shopify*, send the link to someone who can install apps on that
   store. When they approve, Shopify redirects to
   `${SITE_URL}/api/shopify/callback`, which verifies Shopify's HMAC and our
   signed state, exchanges the code for a non-expiring token, and stores it
   in Vault as `<client_id>.shopify.access_token`. The token is never shown.
3. **Switch Sync on** when you're ready for the daily pipeline to include it.

## One-time setup
- Shopify app (Dev Dashboard, custom distribution, legacy install flow) with
  scopes `read_orders,read_customers,read_products` and redirect URLs
  `${SITE_URL}/api/shopify/callback` (production and `http://localhost:3000/...`).
- `agency.shopify.client_secret` in Vault (scripts/set_vault_secret.py).
- `SHOPIFY_CLIENT_ID` and `SITE_URL` in web/.env.local and in Netlify.
- sql/020_client_connections.sql applied (scripts/migrate.py).

## Notes
- The pipeline (src/config/clients.py `load_all`) reads connection details
  from the database; YAML files still work for legacy clients (dev_test).
- A callback that returns an expiring token is refused: custom-distribution
  apps are exempt from Shopify's expiring-token rule, and the pipeline has no
  refresh logic.
- Verified without any live API calls: signed-state/HMAC helpers, input
  normalization, `load_all` overlay, callback rejection paths. The real token
  exchange has not run against Shopify yet.
