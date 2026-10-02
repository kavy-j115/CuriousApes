"""Alert detection: compares today's daily_report_metrics against
yesterday's and flags genuine threshold breaches. Deliberately conservative
-- per the original brief, "do not generate unnecessary notifications."

CAC now uses spend / new customers when that figure is available (merged
in by the caller from daily_new_vs_returning, see
sql/019_new_vs_returning.sql and src/scheduler/run_pipeline.py) -- the
accurate definition. Falls back to spend / total orders otherwise, which
is what this project used before that tracking existed; the alert message
itself states which basis was actually used, rather than silently
treating them as equivalent.
"""

from dataclasses import dataclass


@dataclass
class Alert:
    alert_type: str  # 'revenue_drop' | 'cac_increase' | 'roas_drop'
    message: str


def _pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None  # can't compute a meaningful percentage off a zero baseline
    return (current - previous) / previous * 100


def check_metric_alerts(today_row: dict, yesterday_row: dict | None, thresholds: dict) -> list[Alert]:
    """today_row/yesterday_row: rows from daily_report_metrics (dict-like,
    e.g. RealDictCursor output). Returns only alerts that actually breached
    their threshold -- never fires on missing or zero baseline data, since a
    percentage change against nothing is meaningless, not alarming."""
    if yesterday_row is None:
        return []  # no baseline at all -- nothing to compare against

    alerts: list[Alert] = []

    revenue_threshold = thresholds.get("revenue_change_pct")
    if revenue_threshold is not None:
        today_rev = today_row.get("gross_revenue")
        yesterday_rev = yesterday_row.get("gross_revenue")
        if today_rev is not None and yesterday_rev is not None:
            change = _pct_change(float(today_rev), float(yesterday_rev))
            if change is not None and change <= -revenue_threshold:
                alerts.append(Alert(
                    "revenue_drop",
                    f"Gross revenue dropped {abs(change):.1f}% (${yesterday_rev} -> ${today_rev}), "
                    f"exceeding the {revenue_threshold}% threshold.",
                ))

    cac_threshold = thresholds.get("cac_change_pct")
    if cac_threshold is not None:
        today_cac = _cac(today_row)
        yesterday_cac = _cac(yesterday_row)
        if today_cac is not None and yesterday_cac is not None:
            change = _pct_change(today_cac, yesterday_cac)
            if change is not None and change >= cac_threshold:
                basis = "new customers" if today_row.get("new_customers") and yesterday_row.get("new_customers") else "orders"
                alerts.append(Alert(
                    "cac_increase",
                    f"CAC (spend/{basis}) rose {change:.1f}% (${yesterday_cac:.2f} -> ${today_cac:.2f}), "
                    f"exceeding the {cac_threshold}% threshold.",
                ))

    roas_threshold = thresholds.get("roas_change_pct")
    if roas_threshold is not None:
        today_roas = today_row.get("proas")
        yesterday_roas = yesterday_row.get("proas")
        if today_roas is not None and yesterday_roas is not None:
            change = _pct_change(float(today_roas), float(yesterday_roas))
            if change is not None and change <= -roas_threshold:
                alerts.append(Alert(
                    "roas_drop",
                    f"PROAS dropped {abs(change):.1f}% ({yesterday_roas} -> {today_roas}), "
                    f"exceeding the {roas_threshold}% threshold.",
                ))

    return alerts


def _cac(row: dict) -> float | None:
    spend = row.get("amount_spent")
    if spend is None:
        return None
    new_customers = row.get("new_customers")
    if new_customers:
        return float(spend) / new_customers
    orders = row.get("order_count")
    if not orders:
        return None
    return float(spend) / orders


def save_alerts(conn, client_id: str, alert_date, alerts: list[Alert]) -> None:
    cur = conn.cursor()
    for alert in alerts:
        cur.execute(
            """
            INSERT INTO alerts (client_id, alert_date, alert_type, message)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (client_id, alert_date, alert_type) DO UPDATE SET message = EXCLUDED.message;
            """,
            (client_id, alert_date, alert.alert_type, alert.message),
        )
    conn.commit()
    cur.close()


def save_sync_failure_alert(conn, client_id: str, alert_date, step_name: str, error_detail: str) -> None:
    # alert_type includes step_name so e.g. a Shopify failure and a Meta
    # failure on the same day get separate rows instead of one overwriting
    # the other under the (client_id, alert_date, alert_type) unique constraint.
    alert_type = f"sync_failure_{step_name.lower().replace(' ', '_')}"
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO alerts (client_id, alert_date, alert_type, message)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (client_id, alert_date, alert_type) DO UPDATE SET message = EXCLUDED.message;
        """,
        (client_id, alert_date, alert_type, f"{step_name} failed: {error_detail}"),
    )
    conn.commit()
    cur.close()
