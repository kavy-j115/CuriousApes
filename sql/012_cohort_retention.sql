-- Customer cohort retention and lifetime value. Buildable entirely from
-- data we already have (orders.customer_id + created_at) -- no new data
-- source needed. See docs/metrics.md for formulas.

CREATE OR REPLACE VIEW customer_ltv AS
SELECT
    client_id,
    customer_id,
    COUNT(*) AS order_count,
    SUM(total_price) AS lifetime_value,
    MIN(created_at)::date AS first_order_date,
    MAX(created_at)::date AS last_order_date
FROM orders
WHERE customer_id IS NOT NULL
GROUP BY client_id, customer_id;

-- One row per (client, cohort_month, months_since_cohort): how many of that
-- cohort's customers placed an order that many months after their first
-- order, and what fraction of the cohort that represents.
CREATE OR REPLACE VIEW cohort_retention AS
WITH first_orders AS (
    SELECT client_id, customer_id, date_trunc('month', MIN(created_at))::date AS cohort_month
    FROM orders
    WHERE customer_id IS NOT NULL
    GROUP BY client_id, customer_id
),
customer_months AS (
    SELECT DISTINCT client_id, customer_id, date_trunc('month', created_at)::date AS order_month
    FROM orders
    WHERE customer_id IS NOT NULL
),
raw_counts AS (
    SELECT
        f.client_id,
        f.cohort_month,
        (
            (EXTRACT(YEAR FROM cm.order_month) - EXTRACT(YEAR FROM f.cohort_month)) * 12
            + (EXTRACT(MONTH FROM cm.order_month) - EXTRACT(MONTH FROM f.cohort_month))
        )::int AS months_since_cohort,
        COUNT(DISTINCT cm.customer_id) AS active_customers
    FROM first_orders f
    JOIN customer_months cm ON cm.client_id = f.client_id AND cm.customer_id = f.customer_id
    GROUP BY f.client_id, f.cohort_month, months_since_cohort
),
cohort_sizes AS (
    SELECT client_id, cohort_month, active_customers AS cohort_size
    FROM raw_counts
    WHERE months_since_cohort = 0
)
SELECT
    r.client_id,
    r.cohort_month,
    r.months_since_cohort,
    r.active_customers,
    cs.cohort_size,
    ROUND(r.active_customers::numeric / NULLIF(cs.cohort_size, 0), 4) AS retention_rate
FROM raw_counts r
JOIN cohort_sizes cs ON cs.client_id = r.client_id AND cs.cohort_month = r.cohort_month;

ALTER VIEW customer_ltv SET (security_invoker = true);
ALTER VIEW cohort_retention SET (security_invoker = true);
