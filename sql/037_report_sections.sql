-- Extra report formats (Reports page): orders summary, product sales share, RTO %,
-- monthly health and landing pages. All are read through RLS-respecting views
-- (security_invoker) at DAY grain, so the web app can add up weeks and apply the
-- "completed days only" rule itself.
--
-- Definitions (same as the agency's Kairaus workbook where it has one):
--   repeat order   : the customer has an earlier order in our stored history
--                    (so for a new client it is only as accurate as the history loaded)
--   items per order: number of line-item rows on the order (1 vs more than 1)
--   AOV bucket     : order total up to 5,000 vs above 5,000
--   paid           : financial status PAID (everything else = "Others")
--   RTO            : Shopify has no RTO field, so (as in the agency's Diruno RTO table, checked
--                    against its numbers) RTO % = share of orders whose financial status is
--                    PENDING, i.e. payment not collected yet (cash on delivery, the orders
--                    that can come back undelivered)
--   cancellation check: the order was VOIDED (cancelled before payment)

CREATE OR REPLACE VIEW daily_order_stats AS
WITH items AS (
    SELECT order_id, count(*) AS item_rows FROM order_line_items GROUP BY order_id
),
o AS (
    SELECT
        o.client_id,
        (o.created_at AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS order_date,
        o.total_price,
        upper(COALESCE(o.financial_status, '')) AS fin,
        COALESCE(i.item_rows, 0) AS item_rows,
        (o.customer_id IS NOT NULL
            AND row_number() OVER (PARTITION BY o.client_id, o.customer_id ORDER BY o.created_at, o.id) > 1) AS is_repeat
    FROM orders o
    JOIN clients c ON c.client_id = o.client_id
    LEFT JOIN items i ON i.order_id = o.id
)
SELECT
    client_id,
    order_date,
    count(*)::int                                          AS orders,
    count(*) FILTER (WHERE is_repeat)::int                 AS repeat_orders,
    count(*) FILTER (WHERE item_rows = 1)::int             AS single_item_orders,
    count(*) FILTER (WHERE item_rows > 1)::int             AS multi_item_orders,
    count(*) FILTER (WHERE total_price <= 5000)::int       AS orders_up_to_5000,
    count(*) FILTER (WHERE total_price > 5000)::int        AS orders_over_5000,
    count(*) FILTER (WHERE fin = 'PAID')::int              AS paid_orders,
    COALESCE(sum(total_price), 0)::numeric(14, 2)          AS total_sum,
    count(*) FILTER (WHERE fin = 'PENDING')::int           AS rto_orders,
    count(*) FILTER (WHERE fin = 'VOIDED')::int            AS cancellation_orders
FROM o
GROUP BY client_id, order_date;
ALTER VIEW daily_order_stats SET (security_invoker = true);

CREATE OR REPLACE VIEW daily_product_sales AS
SELECT
    o.client_id,
    (o.created_at AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date AS order_date,
    li.title AS product_title,
    COALESCE(sum(li.quantity * li.unit_price), 0)::numeric(14, 2) AS gross_sales
FROM orders o
JOIN clients c ON c.client_id = o.client_id
JOIN order_line_items li ON li.order_id = o.id
GROUP BY o.client_id, order_date, li.title;
ALTER VIEW daily_product_sales SET (security_invoker = true);

-- Sessions and add-to-cart sessions per landing page and month (Shopify's own
-- "sessions" report grouped by landing page), refreshed by the daily run.
CREATE TABLE IF NOT EXISTS shopify_landing_page_sessions (
    client_id                    TEXT NOT NULL REFERENCES clients(client_id),
    month                        DATE NOT NULL,
    landing_page_path            TEXT NOT NULL,
    sessions                     INTEGER NOT NULL DEFAULT 0,
    sessions_with_cart_additions INTEGER NOT NULL DEFAULT 0,
    fetched_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, month, landing_page_path)
);
ALTER TABLE shopify_landing_page_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins see all landing page sessions" ON shopify_landing_page_sessions;
DROP POLICY IF EXISTS "scoped users see their landing page sessions" ON shopify_landing_page_sessions;
CREATE POLICY "admins see all landing page sessions" ON shopify_landing_page_sessions FOR SELECT USING ((SELECT is_admin()));
CREATE POLICY "scoped users see their landing page sessions" ON shopify_landing_page_sessions FOR SELECT USING (has_client_access(client_id));
