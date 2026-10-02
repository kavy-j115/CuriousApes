# Alerts (Milestone 11)

## Rules implemented

Per the original brief's examples, compared **today vs. yesterday**
(`daily_report_metrics`, most recent two dates with data):

| Alert | Fires when |
|---|---|
| `revenue_drop` | Gross revenue drops by more than `revenue_change_pct` |
| `cac_increase` | CAC rises by more than `cac_change_pct` |
| `roas_drop` | PROAS drops by more than `roas_change_pct` |
| `sync_failure_<step>` | Any pipeline step (Shopify sync, Meta sync, etc.) errors |

Thresholds are per-client, in `config/clients/<id>.yaml`'s `thresholds:`
block (percentages, e.g. `revenue_change_pct: 10` means "alert on a >10%
drop").

**Known approximation, stated plainly:** CAC here is
`amount_spent / order_count` (spend over *all* orders), not the more
precise spend ÷ *new* customers acquired. We don't track new-vs-returning
customers yet — revisit once that exists.

## Data quality checks (unconditional, no per-client config)

Separate from the threshold-based rules above -- these catch broken
ingestion/transform logic, not business swings, so every client gets them
regardless of whether `thresholds:` is configured. Implemented in
`src/analytics/data_quality.py`:

| Alert | Fires when |
|---|---|
| `data_quality_line_items` | An order's `subtotal_price` doesn't match the sum of its own line items (quantity × unit_price), beyond a $1 tolerance for rounding |
| `data_quality_currency` | A client's orders span more than one currency -- this pipeline assumes single-currency throughout, so a mix means revenue totals are silently wrong |

Verified live against real `dev_test` data: temporarily corrupting one
order's `subtotal_price` by $500 correctly produced exactly one
`data_quality_line_items` alert naming that order; reverting it correctly
produced zero.

## Anomaly detection (statistical, no per-client config)

Also separate from the threshold rules: a z-score against each metric's own
trailing history, catching patterns day-over-day % thresholds miss (a slow
multi-day decline, or a day that's unusual for no single-day reason).
Implemented in `src/analytics/anomaly.py`. Needs at least 8 days of history
(7 for the trailing window + today) -- silently produces no alerts before
that, rather than a noisy false "anomaly" off too little data. A trailing
window with zero variance (every prior value identical) is also skipped,
to avoid treating any difference as an "infinite" anomaly.

| Alert | Fires when |
|---|---|
| `anomaly_gross_revenue` / `anomaly_order_count` / `anomaly_amount_spent` / `anomaly_proas` | Today's value is more than 2.5 standard deviations from its trailing 7+ day mean |

Verified with synthetic history (natural day-to-day variance, then an
injected spike and an injected drop): both correctly fired exactly one
alert each; a normal day and a too-short history both correctly fired zero.

## "Never generate unnecessary notifications" (per the brief)

Enforced in `check_metric_alerts()`, verified with synthetic test cases
covering exactly the ways a naive implementation would misfire:
- No alert fires without a real prior-day baseline to compare against
  (missing yesterday data → zero alerts, not a crash or a nonsense
  comparison).
- A metric missing on either day is skipped for that alert only, never
  guessed at.
- A zero-order baseline correctly skips the CAC check rather than
  producing a division-by-zero or a meaningless "infinite increase."
- A change *below* threshold correctly produces no alert (tested
  explicitly, not just the "above threshold" case).

## Storage

`alerts` table (`sql/010_alerts.sql`), one row per (client, date,
alert_type) — upserted, so a rerun is safe and a distinct failure type
(e.g. Shopify sync vs. Meta sync both failing the same day) gets its own
row rather than overwriting.

## A real security fix found while building this

Wiring sync failures into alerts meant the orchestrator's actual error
messages started flowing further through the system — which surfaced that
`src/connectors/meta_ads.py` was sending its access token as a **URL query
parameter**. Fixed to use an `Authorization` header instead (matching how
the Shopify connector already works), and added `_sanitize_url()` as
defense in depth regardless of how a token might end up in a URL again in
the future (e.g. Meta's own pagination "next" URLs, whose exact shape
isn't ours to control). Verified directly: the same real API error that
previously exposed the token in full now shows `access_token=REDACTED`.

**If you're reading this after that token was ever visible in a chat
transcript or log: treat it as compromised and rotate it** (Business
Settings → System Users → Generate New Token), same as any other exposed
credential in this project.

## A real, unrelated bug found while testing

While verifying this feature end-to-end, Meta's API started returning
`"API access blocked"` (an `OAuthException`) for `dev_test`'s ad account.
Verified this is **not** caused by the header-vs-query-param auth change
above — tested both methods directly against the live API and got the
identical error from both, ruling out a code regression. This is a
Meta-side account/app restriction (the same account that needed review
once before in this project) and needs checking in Meta's Business
Settings/App Dashboard, not a code fix.

## Sending: WhatsApp

Alerts are also sent over WhatsApp — see docs/notifications.md for the
full design (why WhatsApp, why templates are required, the agency-level
sender vs. per-client recipients split, and delivery semantics).

## UI

Alerts are shown in the dashboard's Alerts page (`web/src/app/dashboard/alerts/page.tsx`),
styled by alert_type prefix (red for threshold breaches, amber for sync
failures/data quality, purple for statistical anomalies).
