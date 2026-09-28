-- Milestone 2: initial raw layer.
-- clients: one row per brand this agency manages.
CREATE TABLE IF NOT EXISTS clients (
    client_id     TEXT PRIMARY KEY,        -- matches config/clients/<client_id>.yaml
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- raw_shopify_orders: landing zone for Shopify order data, unmodified.
-- One row per (client, Shopify order). raw_data holds the API's JSON response as-is;
-- we deliberately do NOT model individual fields here yet — that happens in the
-- transformation layer once we know which fields we actually need.
CREATE TABLE IF NOT EXISTS raw_shopify_orders (
    id                BIGSERIAL PRIMARY KEY,
    client_id         TEXT NOT NULL REFERENCES clients(client_id),
    shopify_order_id  BIGINT NOT NULL,
    raw_data          JSONB NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, shopify_order_id)
);

-- Speeds up "give me all orders for this client" and JSON field lookups later.
CREATE INDEX IF NOT EXISTS idx_raw_shopify_orders_client ON raw_shopify_orders(client_id);
