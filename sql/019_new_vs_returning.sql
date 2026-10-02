-- New vs. returning customers, per day -- buildable entirely from orders
-- (same source customer_ltv/cohort_retention already use, see
-- sql/012_cohort_retention.sql), no new data source needed. "New" = this
-- is the customer's first-ever order; "returning" = they'd ordered before.
CREATE OR REPLACE VIEW daily_new_vs_returning AS
WITH first_orders AS (
    SELECT client_id, customer_id, (MIN(created_at) AT TIME ZONE 'UTC')::date AS first_order_date
    FROM orders
    WHERE customer_id IS NOT NULL
    GROUP BY client_id, customer_id
)
SELECT
    o.client_id,
    (o.created_at AT TIME ZONE 'UTC')::date AS order_date,
    COUNT(DISTINCT o.customer_id) FILTER (
        WHERE fo.first_order_date = (o.created_at AT TIME ZONE 'UTC')::date
    ) AS new_customers,
    COUNT(DISTINCT o.customer_id) FILTER (
        WHERE fo.first_order_date < (o.created_at AT TIME ZONE 'UTC')::date
    ) AS returning_customers,
    COALESCE(SUM(o.total_price) FILTER (
        WHERE fo.first_order_date = (o.created_at AT TIME ZONE 'UTC')::date
    ), 0) AS new_revenue,
    COALESCE(SUM(o.total_price) FILTER (
        WHERE fo.first_order_date < (o.created_at AT TIME ZONE 'UTC')::date
    ), 0) AS returning_revenue
FROM orders o
JOIN first_orders fo ON fo.client_id = o.client_id AND fo.customer_id = o.customer_id
WHERE o.customer_id IS NOT NULL
GROUP BY o.client_id, (o.created_at AT TIME ZONE 'UTC')::date;

-- security_invoker so this relies on orders' own existing RLS policies
-- (sql/011_auth_and_rls.sql) for the calling user, same pattern as every
-- other view in this project.
ALTER VIEW daily_new_vs_returning SET (security_invoker = true);
