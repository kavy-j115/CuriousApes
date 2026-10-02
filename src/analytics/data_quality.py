"""Data quality checks: structural sanity checks on the clean layer
(orders/order_line_items), independent of the day-over-day alert thresholds
in src/analytics/alerts.py. These catch broken ingestion/transform logic
(a bad Shopify payload, a currency mix-up) rather than genuine business
swings, so they run unconditionally -- no per-client threshold config.

Each check returns a list of Alert (reusing the same dataclass and the same
alerts table as the threshold-based alerts, via save_alerts), so they show
up in the same UI/WhatsApp pipes without a separate storage path.
"""

from src.analytics.alerts import Alert

LINE_ITEM_MISMATCH_TOLERANCE = 1.00  # currency units; rounding/manual edits can cause tiny gaps


def check_line_item_totals(conn, client_id: str, since: str) -> list[Alert]:
    """Flags orders whose subtotal doesn't reconcile with their own line items
    -- a sign the transform step mapped something wrong, or Shopify sent a
    payload shape we don't handle yet.

    Reconciles subtotal + discounts against line items at original price,
    because Shopify's subtotal is AFTER discounts while line items are
    BEFORE them (comparing them directly flags every discounted order). Only
    intact orders are checked: cancelled/voided orders have their totals
    zeroed by Shopify, and refunded orders have lower current totals, so
    both would be expected "mismatches", not data errors."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT o.order_number, o.subtotal_price, o.total_discounts, COALESCE(SUM(li.quantity * li.unit_price), 0) AS line_items_total
        FROM orders o
        LEFT JOIN order_line_items li ON li.order_id = o.id
        WHERE o.client_id = %s AND o.created_at >= %s
          AND o.total_price > 0 AND o.total_refunded = 0
        GROUP BY o.id, o.order_number, o.subtotal_price, o.total_discounts
        HAVING ABS(o.subtotal_price + o.total_discounts - COALESCE(SUM(li.quantity * li.unit_price), 0)) > %s;
        """,
        (client_id, since, LINE_ITEM_MISMATCH_TOLERANCE),
    )
    rows = cur.fetchall()
    cur.close()

    if not rows:
        return []

    examples = ", ".join(
        f"{order_number} (subtotal {subtotal} + discounts {discounts}, line items {line_total})"
        for order_number, subtotal, discounts, line_total in rows[:5]
    )
    return [Alert(
        "data_quality_line_items",
        f"{len(rows)} order(s) since {since} don't reconcile with their line items "
        f"(subtotal + discounts off by more than {LINE_ITEM_MISMATCH_TOLERANCE}): {examples}.",
    )]


def check_currency_consistency(conn, client_id: str) -> list[Alert]:
    """Flags a client whose orders span more than one currency. This
    pipeline assumes a single-currency store throughout (see docs/metrics.md);
    a mix usually means a store migrated currencies or the wrong store was
    synced, and every revenue number downstream would be silently wrong."""
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT currency FROM orders WHERE client_id = %s;",
        (client_id,),
    )
    currencies = [r[0] for r in cur.fetchall()]
    cur.close()

    if len(currencies) <= 1:
        return []

    return [Alert(
        "data_quality_currency",
        f"Orders for this client span multiple currencies ({', '.join(sorted(currencies))}) -- "
        f"revenue totals mix currencies and are not reliable until this is resolved.",
    )]


def run_data_quality_checks(conn, client_id: str, since: str) -> list[Alert]:
    return check_line_item_totals(conn, client_id, since) + check_currency_consistency(conn, client_id)
