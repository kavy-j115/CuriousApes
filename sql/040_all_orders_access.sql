-- Whether this client's Shopify install was granted the read_all_orders scope. Without it Shopify
-- only lets us read the last 60 days of orders; with it, any age. Set automatically when the store
-- installs (the install answer lists the granted scopes), so a store installed before the scope was
-- approved stays on 60 days until it is reinstalled through the updated app.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS all_orders_access BOOLEAN NOT NULL DEFAULT false;
