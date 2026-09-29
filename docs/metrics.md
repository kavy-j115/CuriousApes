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

## Blended report metrics (`daily_report_metrics`)

Computed by `sql/006_daily_report_metrics.sql`, joining Shopify + Meta + GA4
by (client, date). Built for the "Business Health Report" format.

| Metric | Formula | Notes |
|---|---|---|
| `amount_spent` | sum of Meta `spend` | |
| `purchase_value` | sum of Meta's `purchase`-type `action_values` | see docs/connectors.md for the action_type ambiguity caveat |
| `proas` (Purchase ROAS) | `purchase_value / amount_spent` | |
| `atc_pct` | `add_to_carts / sessions` | GA4 event count, not deduplicated sessions — see docs/connectors.md |
| `conversion_pct` | **Shopify** `order_count / sessions` | **Assumption, stated explicitly rather than guessed silently:** interpreted from the target report format as orders over site sessions. Crosses two data sources — correct this if it doesn't match your intended definition |
| `checkout_pct` | `checkouts / sessions` | GA4 event count, same caveat as `atc_pct` |
| `mtd_sale` (Month-to-Date) | running sum of `gross_revenue` from the 1st of the month through the current row, per client | a SQL window function, not a `GROUP BY` — each day keeps its own row and its own running total |
| `lmtd_sale` (Last-Month-to-Date) | the previous month's `mtd_sale` on the matching day-of-month | via `date - interval '1 month'`. **Known edge case:** Postgres clamps overflow days (e.g. Mar 31 → Feb 28), so day-31 rows can compare against a slightly different actual date in a shorter previous month |

Verified against hand-calculated synthetic data spanning two months
(`scripts/sanity_check_report_metrics.py`) — not yet against real multi-month
client data, since we don't have any yet.

## Cohort retention & LTV (`sql/012_cohort_retention.sql`)

Buildable entirely from data already in `orders` — no new data source
needed, unlike most of Milestone 14's other ideas (contribution margin
needs COGS data we don't have; channel economics needs real ad spend,
currently blocked on the Meta account issue).

| Metric | Formula |
|---|---|
| `customer_ltv.lifetime_value` | sum of `total_price` across all of a customer's orders |
| `cohort_retention.cohort_month` | the calendar month of a customer's *first* order |
| `cohort_retention.months_since_cohort` | how many months after their cohort month a given order month is (0 = their first month) |
| `cohort_retention.retention_rate` | (customers active in that month) / (total customers in that cohort) |

Verified against synthetic multi-month data covering the cases that
would silently break a naive implementation: a customer with a real gap
between orders (month 0 and month 2, nothing in month 1), a customer with
no repeat order at all, and a second cohort starting in a different
month — all four resulting rows matched hand-calculated expectations
exactly. Also re-verified RLS isolation specifically on these two new
views (not just assumed inherited from the pattern used elsewhere).

## Not yet built

New vs. returning customers, per-product revenue/contribution — deferred
until we have more than 3 test orders to meaningfully validate them against.
