-- Per-(client, product) aggregates -- powers the Segments page's new
-- "select from our data" product-browsing path, and doubles as the
-- product-level revenue analytics the original brief asked for (deferred
-- until now for lack of test data to validate against, see docs/metrics.md
-- "Not yet built"). Buildable entirely from order_line_items + orders,
-- same as customer_ltv/cohort_retention -- no new data source needed.
CREATE OR REPLACE VIEW product_performance AS
SELECT
    o.client_id,
    oli.title,
    oli.sku,
    SUM(oli.quantity) AS units_sold,
    SUM(oli.quantity * oli.unit_price) AS revenue,
    COUNT(DISTINCT o.customer_id) AS distinct_customers
FROM order_line_items oli
JOIN orders o ON o.id = oli.order_id
GROUP BY o.client_id, oli.title, oli.sku;

-- security_invoker so this relies on orders/order_line_items' own existing
-- RLS policies (sql/011_auth_and_rls.sql) for the calling user, rather
-- than running as the view owner -- same pattern as every other view in
-- this project.
ALTER VIEW product_performance SET (security_invoker = true);
