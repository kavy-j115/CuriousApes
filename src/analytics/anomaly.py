"""Statistical anomaly detection: flags a metric whose value today is an
outlier against its own recent history, using a z-score (how many standard
deviations away from the trailing mean). This catches patterns the simple
day-over-day % thresholds in alerts.py miss -- e.g. a slow multi-day decline
where each individual day-over-day drop is small, or a metric that's merely
"unusually low for a Tuesday" without dropping relative to yesterday at all.

Deliberately separate from check_metric_alerts(): that function is
threshold-based and per-client-configured; this is unsupervised and needs
no config, but also needs enough history to mean anything, so it's silent
(not a false "no anomaly") until that history exists.
"""

import statistics

from src.analytics.alerts import Alert

MIN_HISTORY_DAYS = 7  # fewer points than this and a stdev is too noisy to trust
Z_SCORE_THRESHOLD = 2.5  # ~99% of normally-distributed values fall within this

ANOMALY_METRICS = {
    "gross_revenue": "Gross revenue",
    "order_count": "Order count",
    "amount_spent": "Ad spend",
    "proas": "PROAS",
}


def _zscore(value: float, history: list[float]) -> float | None:
    if len(history) < MIN_HISTORY_DAYS:
        return None
    mean = statistics.mean(history)
    try:
        stdev = statistics.stdev(history)
    except statistics.StatisticsError:
        return None  # all identical values
    if stdev == 0:
        return None  # no variance at all -- any difference would be a false "infinite" anomaly
    return (value - mean) / stdev


def check_anomalies(rows: list[dict]) -> list[Alert]:
    """rows: daily_report_metrics rows for one client, ordered by report_date
    ascending, most recent last (same shape run_pipeline.py already fetches
    for the Report step). Compares the last row against every prior row as
    trailing history."""
    if len(rows) < MIN_HISTORY_DAYS + 1:
        return []

    today = rows[-1]
    history_rows = rows[:-1]

    alerts: list[Alert] = []
    for metric_key, label in ANOMALY_METRICS.items():
        today_value = today.get(metric_key)
        if today_value is None:
            continue
        history = [float(r[metric_key]) for r in history_rows if r.get(metric_key) is not None]
        z = _zscore(float(today_value), history)
        if z is None or abs(z) < Z_SCORE_THRESHOLD:
            continue
        direction = "above" if z > 0 else "below"
        mean = statistics.mean(history)
        alerts.append(Alert(
            f"anomaly_{metric_key}",
            f"{label} ({today_value:.2f}) is unusually {direction} its trailing {len(history)}-day average "
            f"({mean:.2f}, z-score {z:.1f}) -- outside the normal range even without a day-over-day drop.",
        ))

    return alerts
