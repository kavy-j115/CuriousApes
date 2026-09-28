# Metrics

Computed by the `daily_business_metrics` view
(sql/002_clean_and_analytics_layer.sql), one row per (client, calendar day,
UTC).

| Metric | Formula | Notes |
|---|---|---|
| `order_count` | count of orders placed that day | |
| `gross_revenue` | sum of `orders.total_price` | Shopify's order total: post-discount, pre-refund, **includes** tax & shipping |
| `total_discounts` | sum of `orders.total_discounts` | informational — discounts are already netted into `total_price`, this isn't subtracted again |
| `total_refunded` | sum of `orders.total_refunded` | |
| `net_revenue` | `gross_revenue - total_refunded` | revenue actually retained |
| `aov` (Average Order Value) | `net_revenue / order_count` | |
| `units_sold` | sum of line item quantities | |

## Known simplification: refunds vs. order edits

Shopify tracks two different kinds of change to an order after it's placed:
**edits** (e.g. a line item removed — reflected directly in
`currentTotalPriceSet`, which is what we store as `total_price`) and
**refunds** (money returned to the customer — tracked separately via
`totalRefundedSet`).

Our `net_revenue = gross_revenue - total_refunded` formula assumes these
don't overlap in a way that double-counts. For the vast majority of D2C
orders (no edit, or a refund with no edit) this is accurate. It can become
inexact in an edge case where an order is both edited *and* refunded. We are
not solving that now — it adds real complexity for a case that's rare in
practice. If real client data ever shows numbers here that look wrong,
this is the first place to look.

## Not yet built

New vs. returning customers, per-product revenue/contribution — deferred
until we have more than 3 test orders to meaningfully validate them against.
