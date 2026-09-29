-- Per-source daily analytics views for Meta and GA4, mirroring
-- daily_business_metrics for Shopify. See docs/metrics.md for formulas.

CREATE OR REPLACE VIEW daily_meta_metrics AS
SELECT
    client_id,
    insight_date AS report_date,
    SUM((raw_data->>'spend')::numeric) AS amount_spent,
    SUM(
        COALESCE((
            SELECT (elem->>'value')::numeric
            FROM jsonb_array_elements(raw_data->'actions') elem
            WHERE elem->>'action_type' = 'purchase'
        ), 0)
    ) AS purchases,
    SUM(
        COALESCE((
            SELECT (elem->>'value')::numeric
            FROM jsonb_array_elements(raw_data->'action_values') elem
            WHERE elem->>'action_type' = 'purchase'
        ), 0)
    ) AS purchase_value
FROM raw_meta_insights
GROUP BY client_id, insight_date;

CREATE OR REPLACE VIEW daily_ga4_metrics AS
SELECT
    client_id,
    session_date AS report_date,
    (raw_data->>'sessions')::int AS sessions,
    (raw_data->>'addToCarts')::int AS add_to_carts,
    (raw_data->>'checkouts')::int AS checkouts
FROM raw_ga4_sessions;
