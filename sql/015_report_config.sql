-- Surfaces net_revenue (gross_revenue minus refunds -- already computed in
-- daily_business_metrics, see docs/metrics.md) through daily_report_metrics,
-- where it wasn't exposed before. This exists because different clients
-- call their headline sales number different things -- some want gross
-- revenue (pre-refund), others want it net of refunds -- and net_revenue
-- already existed one layer down, just never made it into the blended view
-- the UI actually reads from.
-- DROP + CREATE, not CREATE OR REPLACE: Postgres refuses to reorder/insert
-- a view's existing columns via REPLACE ("cannot change name of view
-- column") -- net_revenue needs to sit next to gross_revenue for
-- readability, not get tacked on at the end. Safe to drop since nothing
-- else is defined on top of this view.
DROP VIEW IF EXISTS daily_report_metrics;
CREATE VIEW daily_report_metrics AS
WITH monthly_cumulative AS (
    SELECT
        client_id,
        order_date,
        gross_revenue,
        net_revenue,
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
    m.net_revenue,
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

ALTER VIEW daily_report_metrics SET (security_invoker = true);

-- NULL = use the app's default report column set/labels/order. A client
-- with different reporting needs (e.g. "Total Sales" meaning net_revenue
-- instead of gross_revenue, or a different column subset entirely) gets an
-- explicit ordered list here instead -- see web/src/lib/reportColumns.ts
-- for the shape and the fixed set of underlying metrics this can select
-- from (it can only reorder/relabel/include-or-exclude existing metrics,
-- not invent new formulas -- a new formula is still a real code change).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS report_config JSONB;
