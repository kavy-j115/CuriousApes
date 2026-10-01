"""Generates and sends the Daily/Weekly/Monthly Business Health Report
(DHR) over WhatsApp. Reuses the exact same Excel generator and column
format as the on-demand download (business_health_report.py) -- a
"weekly"/"monthly" DHR is just that same generator given a wider range of
daily_report_metrics rows, which is already how it produces a Total row
(every row plus a weighted-total summary row, not a separate aggregation
path -- confirmed by reading generate_report() rather than assumed).

report_columns/roas_thresholds (resolved by the caller via
src.reports.report_columns, from the same report_config a client's web
Reports page reads -- sql/015_report_config.sql) are threaded straight
through to generate_report() -- a DHR matches what that client sees on
the web, not a separate fixed format.
"""

from datetime import date, timedelta
from pathlib import Path

import psycopg2.extras

from src.reports.business_health_report import generate_report
from src.reports.storage import ensure_bucket_exists, upload_file, create_signed_url
from src.notifications.whatsapp import send_whatsapp_media

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "reports" / "output" / "dhr"

PERIOD_LABELS = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}


def _period_range(period: str) -> tuple[str, str]:
    today = date.today()
    if period == "daily":
        return today.isoformat(), today.isoformat()
    if period == "weekly":
        return (today - timedelta(days=6)).isoformat(), today.isoformat()
    if period == "monthly":
        return today.replace(day=1).isoformat(), today.isoformat()
    raise ValueError(f"Unknown DHR period: {period}")


def generate_and_send_dhr(
    conn,
    client_id: str,
    display_name: str,
    period: str,
    recipients: list[str],
    whatsapp_config: dict,
    supabase_url: str | None,
    service_role_key: str | None,
    report_columns: list[tuple[str, str, str]] | None = None,
    roas_thresholds: dict | None = None,
) -> str:
    """Returns a short status string for logging. Never raises for an
    expected "nothing to send" case (no recipients, storage not
    configured, no data yet) -- only once a send was actually attempted
    and failed, same "skipped vs. error" distinction every other pipeline
    step uses."""
    if not recipients:
        return "skipped (no whatsapp_recipients)"
    if not supabase_url or not service_role_key:
        return "skipped (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set)"

    start, end = _period_range(period)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s AND report_date <= %s ORDER BY report_date;",
        (client_id, start, end),
    )
    rows = cur.fetchall()
    cur.close()

    if not rows:
        return "skipped (no data in this period)"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{client_id}_{period}_dhr_{end}.xlsx"
    output_path = OUTPUT_DIR / filename
    generate_report(rows, f"{display_name} -- {PERIOD_LABELS[period]}", str(output_path), report_columns, roas_thresholds)

    ensure_bucket_exists(supabase_url, service_role_key)
    storage_path = upload_file(str(output_path), f"{client_id}/dhr/{filename}", supabase_url, service_role_key)
    media_url = create_signed_url(supabase_url, service_role_key, storage_path)

    caption = f"{display_name} -- {PERIOD_LABELS[period]} Business Health Report ({end})"
    for phone in recipients:
        send_whatsapp_media(
            whatsapp_config["account_sid"],
            whatsapp_config["auth_token"],
            whatsapp_config["from_number"],
            phone,
            media_url,
            caption,
        )

    return f"sent to {len(recipients)} recipient(s)"
