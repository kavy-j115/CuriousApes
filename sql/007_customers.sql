-- Customer-level data, extracted from the customer field already present on
-- each order's raw JSON. A dedicated table rather than columns on `orders`,
-- since one customer has many orders -- storing name/phone/email per-order
-- would duplicate the same values across every order row.
CREATE TABLE IF NOT EXISTS customers (
    id                  BIGSERIAL PRIMARY KEY,
    client_id           TEXT NOT NULL REFERENCES clients(client_id),
    shopify_customer_id TEXT NOT NULL,
    email               TEXT,
    phone               TEXT,   -- raw as Shopify gives it, e.g. "+919050111111"
    first_name          TEXT,
    last_name           TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, shopify_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_client ON customers(client_id);
