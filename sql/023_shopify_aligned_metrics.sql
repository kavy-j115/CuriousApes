-- Align daily metrics with how Shopify's own reports define them, and cut
-- days in each client's own time zone instead of UTC.
--
-- Before: "gross_revenue" = SUM(total_price) -- the AFTER-discount order total
-- (incl. shipping/tax, zeroed for cancelled orders) -- and days were cut at
-- UTC midnight, so an IST store's early-morning orders landed on the
-- previous day. Both made our numbers disagree with Shopify's reports.
--
-- Now (Shopify's definitions):
--   gross_revenue    = line items at ORIGINAL price (Shopify "Gross sales")
--   total_discounts  = discounts
--   total_refunded   = refunds/returns
--   net_revenue      = gross - discounts - refunds (Shopify "Net sales")
--   total_sales      = order totals as charged (after discounts/refunds, incl.
--                      shipping & tax) -- what used to be called gross_revenue
--   aov              = total_sales / orders
-- Cancelled (VOIDED) orders are excluded from counts and sales, as in
-- Shopify's reports. order_count is non-cancelled orders only.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
UPDATE clients SET timezone = 'Asia/Kolkata' WHERE client_id = 'diruno-fashion';

CREATE OR REPLACE VIEW daily_business_metrics AS
WITH order_items AS (
    SELECT order_id, SUM(quantity) AS units, SUM(quantity * unit_price) AS gross_items
    FROM order_line_items
    GROUP BY order_id
)
SELECT
    o.client_id,
    (o.created_at AT TIME ZONE c.timezone)::date AS order_date,
    COUNT(*) AS order_count,
    COALESCE(SUM(oi.gross_items), 0) AS gross_revenue,
    SUM(o.total_discounts) AS total_discounts,
    SUM(o.total_refunded) AS total_refunded,
    COALESCE(SUM(oi.gross_items), 0) - SUM(o.total_discounts) - SUM(o.total_refunded) AS net_revenue,
    ROUND(SUM(o.total_price) / NULLIF(COUNT(*), 0), 2) AS aov,
    COALESCE(SUM(oi.units), 0) AS units_sold,
    SUM(o.total_price) AS total_sales
FROM orders o
JOIN clients c ON c.client_id = o.client_id
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.financial_status IS DISTINCT FROM 'VOIDED'
GROUP BY o.client_id, (o.created_at AT TIME ZONE c.timezone)::date;

CREATE OR REPLACE VIEW daily_report_metrics AS
WITH monthly_cumulative AS (
    SELECT
        client_id,
        order_date,
        gross_revenue,
        net_revenue,
        order_count,
        aov,
        total_discounts,
        total_refunded,
        total_sales,
        SUM(gross_revenue) OVER (
            PARTITION BY client_id, date_trunc('month', order_date)
            ORDER BY order_date
        ) AS mtd_sale
    FROM daily_business_metrics
)
SELECT
    m.client_id,
    m.order_date AS report_date,
    ga.sessions,
    ga.add_to_carts,
    ga.checkouts,
    m.order_count,
    m.gross_revenue,
    m.net_revenue,
    m.aov,
    me.amount_spent,
    me.purchase_value,
    (me.purchase_value / NULLIF(me.amount_spent, 0)) AS proas,
    (ga.add_to_carts::numeric / NULLIF(ga.sessions, 0)) AS atc_pct,
    (m.order_count::numeric / NULLIF(ga.sessions, 0)) AS conversion_pct,
    (ga.checkouts::numeric / NULLIF(ga.sessions, 0)) AS checkout_pct,
    m.mtd_sale,
    lm.mtd_sale AS lmtd_sale,
    m.total_discounts,
    m.total_refunded,
    m.total_sales
FROM monthly_cumulative m
LEFT JOIN monthly_cumulative lm
    ON lm.client_id = m.client_id
    AND lm.order_date = (m.order_date - interval '1 month')::date
LEFT JOIN daily_meta_metrics me
    ON me.client_id = m.client_id AND me.report_date = m.order_date
LEFT JOIN daily_ga4_metrics ga
    ON ga.client_id = m.client_id AND ga.report_date = m.order_date;

-- New vs returning customers, bucketed in the client's time zone too.
CREATE OR REPLACE VIEW daily_new_vs_returning AS
WITH first_orders AS (
    SELECT o.client_id, o.customer_id, (MIN(o.created_at) AT TIME ZONE c.timezone)::date AS first_order_date
    FROM orders o
    JOIN clients c ON c.client_id = o.client_id
    WHERE o.customer_id IS NOT NULL AND o.financial_status IS DISTINCT FROM 'VOIDED'
    GROUP BY o.client_id, o.customer_id, c.timezone
)
SELECT
    o.client_id,
    (o.created_at AT TIME ZONE c.timezone)::date AS order_date,
    COUNT(DISTINCT o.customer_id) FILTER (
        WHERE fo.first_order_date = (o.created_at AT TIME ZONE c.timezone)::date
    ) AS new_customers,
    COUNT(DISTINCT o.customer_id) FILTER (
        WHERE fo.first_order_date < (o.created_at AT TIME ZONE c.timezone)::date
    ) AS returning_customers,
    COALESCE(SUM(o.total_price) FILTER (
        WHERE fo.first_order_date = (o.created_at AT TIME ZONE c.timezone)::date
    ), 0) AS new_revenue,
    COALESCE(SUM(o.total_price) FILTER (
        WHERE fo.first_order_date < (o.created_at AT TIME ZONE c.timezone)::date
    ), 0) AS returning_revenue
FROM orders o
JOIN clients c ON c.client_id = o.client_id
JOIN first_orders fo ON fo.client_id = o.client_id AND fo.customer_id = o.customer_id
WHERE o.customer_id IS NOT NULL AND o.financial_status IS DISTINCT FROM 'VOIDED'
GROUP BY o.client_id, (o.created_at AT TIME ZONE c.timezone)::date;

ALTER VIEW daily_business_metrics SET (security_invoker = true);
ALTER VIEW daily_report_metrics SET (security_invoker = true);
ALTER VIEW daily_new_vs_returning SET (security_invoker = true);
