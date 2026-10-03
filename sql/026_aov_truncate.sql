-- AOV: Shopify truncates to 2 decimals rather than rounding; match it.
-- The report view: Shopify's own numbers win for any day they exist; the
-- order-based calculation (daily_business_metrics) only fills days Shopify's
-- analytics weren't fetched for. Sessions/cart/checkout come from GA4 when
-- that client has it, otherwise from Shopify's sessions.
--   aov = (gross - discounts) / orders, truncated (not rounded) to 2 decimals --
--     that is what Shopify's Analytics page shows (checked on three days)
--   checkout_pct = orders / sessions with cart additions  (the agency's BHR
--     definition: "of the people who added to cart, how many ordered")
--   mtd/lmtd exist for both gross sales and total sales -- each client's
--     report picks whichever sales figure it headlines.
CREATE OR REPLACE VIEW daily_report_metrics AS
WITH unified AS (
    SELECT
        COALESCE(sa.client_id, b.client_id) AS client_id,
        COALESCE(sa.report_date, b.order_date) AS order_date,
        COALESCE(sa.orders, b.order_count)::bigint AS order_count,
        COALESCE(sa.gross_sales, b.gross_revenue) AS gross_revenue,
        COALESCE(sa.net_sales, b.net_revenue) AS net_revenue,
        CASE
            WHEN sa.client_id IS NOT NULL THEN TRUNC((sa.gross_sales - sa.discounts) / NULLIF(sa.orders, 0), 2)
            ELSE b.aov
        END AS aov,
        COALESCE(sa.discounts, b.total_discounts) AS total_discounts,
        COALESCE(sa.returns, b.total_refunded) AS total_refunded,
        COALESCE(sa.total_sales, b.total_sales) AS total_sales
    FROM shopify_daily_sales sa
    FULL OUTER JOIN daily_business_metrics b
        ON b.client_id = sa.client_id AND b.order_date = sa.report_date
),
monthly_cumulative AS (
    SELECT
        client_id, order_date, gross_revenue, net_revenue, order_count, aov,
        total_discounts, total_refunded, total_sales,
        SUM(gross_revenue) OVER (
            PARTITION BY client_id, date_trunc('month', order_date)
            ORDER BY order_date
        ) AS mtd_sale,
        SUM(total_sales) OVER (
            PARTITION BY client_id, date_trunc('month', order_date)
            ORDER BY order_date
        ) AS mtd_total_sales
    FROM unified
)
SELECT
    m.client_id,
    m.order_date AS report_date,
    COALESCE(ga.sessions, ss.sessions) AS sessions,
    COALESCE(ga.add_to_carts, ss.added_to_cart) AS add_to_carts,
    COALESCE(ga.checkouts, ss.reached_checkout) AS checkouts,
    m.order_count,
    m.gross_revenue,
    m.net_revenue,
    m.aov,
    me.amount_spent,
    me.purchase_value,
    (me.purchase_value / NULLIF(me.amount_spent, 0)) AS proas,
    (COALESCE(ga.add_to_carts, ss.added_to_cart)::numeric / NULLIF(COALESCE(ga.sessions, ss.sessions), 0)) AS atc_pct,
    (m.order_count::numeric / NULLIF(COALESCE(ga.sessions, ss.sessions), 0)) AS conversion_pct,
    (m.order_count::numeric / NULLIF(COALESCE(ga.add_to_carts, ss.added_to_cart), 0)) AS checkout_pct,
    m.mtd_sale,
    lm.mtd_sale AS lmtd_sale,
    m.total_discounts,
    m.total_refunded,
    m.total_sales,
    m.mtd_total_sales,
    lm.mtd_total_sales AS lmtd_total_sales
FROM monthly_cumulative m
LEFT JOIN monthly_cumulative lm
    ON lm.client_id = m.client_id
    AND lm.order_date = (m.order_date - interval '1 month')::date
LEFT JOIN daily_meta_metrics me
    ON me.client_id = m.client_id AND me.report_date = m.order_date
LEFT JOIN daily_ga4_metrics ga
    ON ga.client_id = m.client_id AND ga.report_date = m.order_date
LEFT JOIN shopify_daily_sessions ss
    ON ss.client_id = m.client_id AND ss.report_date = m.order_date;

ALTER VIEW daily_report_metrics SET (security_invoker = true);
