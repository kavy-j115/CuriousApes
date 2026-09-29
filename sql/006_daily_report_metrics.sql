-- The final blended view the Excel report reads from directly: Shopify +
-- Meta + GA4, joined by (client_id, date), matching the target report
-- format's columns. See docs/metrics.md for every formula and assumption.
--
-- MTD/LMTD use a window function (SUM() OVER (... ORDER BY date)) to get a
-- running cumulative total per row, without collapsing rows the way a plain
-- GROUP BY would -- each day keeps its own row, but also knows the running
-- total up to and including itself.
CREATE OR REPLACE VIEW daily_report_metrics AS
WITH monthly_cumulative AS (
    SELECT
        client_id,
        order_date,
        gross_revenue,
        order_count,
        aov,
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
    m.aov,
    me.amount_spent,
    me.purchase_value,
    (me.purchase_value / NULLIF(me.amount_spent, 0)) AS proas,
    (ga.add_to_carts::numeric / NULLIF(ga.sessions, 0)) AS atc_pct,
    (m.order_count::numeric / NULLIF(ga.sessions, 0)) AS conversion_pct,
    (ga.checkouts::numeric / NULLIF(ga.sessions, 0)) AS checkout_pct,
    m.mtd_sale,
    lm.mtd_sale AS lmtd_sale
FROM monthly_cumulative m
LEFT JOIN monthly_cumulative lm
    ON lm.client_id = m.client_id
    AND lm.order_date = (m.order_date - interval '1 month')::date
LEFT JOIN daily_meta_metrics me
    ON me.client_id = m.client_id AND me.report_date = m.order_date
LEFT JOIN daily_ga4_metrics ga
    ON ga.client_id = m.client_id AND ga.report_date = m.order_date;
