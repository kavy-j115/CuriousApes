-- Milestone 5: clean layer (typed columns, extracted from raw JSONB) and
-- analytics layer (a view computing daily D2C metrics on top of it).

CREATE TABLE IF NOT EXISTS orders (
    id                   BIGSERIAL PRIMARY KEY,
    client_id            TEXT NOT NULL REFERENCES clients(client_id),
    shopify_order_id     BIGINT NOT NULL,
    order_number         TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    financial_status     TEXT,
    fulfillment_status   TEXT,
    currency             TEXT NOT NULL,
    total_price          NUMERIC(12, 2) NOT NULL,
    subtotal_price       NUMERIC(12, 2) NOT NULL,
    total_discounts      NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_refunded       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    customer_id          TEXT,
    UNIQUE (client_id, shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_client_date ON orders(client_id, created_at);

CREATE TABLE IF NOT EXISTS order_line_items (
    id          BIGSERIAL PRIMARY KEY,
    order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sku         TEXT,
    title       TEXT NOT NULL,
    quantity    INT NOT NULL,
    unit_price  NUMERIC(12, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_line_items_order ON order_line_items(order_id);

-- Analytics layer: one row per (client, day). See docs/metrics.md for formula
-- definitions and the known simplifications around refunds/order edits.
CREATE OR REPLACE VIEW daily_business_metrics AS
WITH order_units AS (
    SELECT order_id, SUM(quantity) AS units
    FROM order_line_items
    GROUP BY order_id
)
SELECT
    o.client_id,
    (o.created_at AT TIME ZONE 'UTC')::date AS order_date,
    COUNT(*) AS order_count,
    SUM(o.total_price) AS gross_revenue,
    SUM(o.total_discounts) AS total_discounts,
    SUM(o.total_refunded) AS total_refunded,
    SUM(o.total_price) - SUM(o.total_refunded) AS net_revenue,
    ROUND((SUM(o.total_price) - SUM(o.total_refunded)) / NULLIF(COUNT(*), 0), 2) AS aov,
    COALESCE(SUM(ou.units), 0) AS units_sold
FROM orders o
LEFT JOIN order_units ou ON ou.order_id = o.id
GROUP BY o.client_id, (o.created_at AT TIME ZONE 'UTC')::date;
