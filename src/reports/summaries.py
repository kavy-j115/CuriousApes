"""Weekly (last 7 days) and monthly (last 30 days) summary Excel reports.

Same generator and column format as the daily report -- a summary is the
daily report restricted to a window, whose Total row is the weighted summary.
Written to Supabase Storage under <client_id>/summary/ with fixed names, so
the Reports page's Weekly/Monthly download buttons always get the latest.

Reads only our own database (daily_report_metrics); the only network call is
the upload to our own Supabase Storage. Never contacts Shopify/Meta/GA4.
"""

import tempfile
from datetime import timedelta
from pathlib import Path

import psycopg2.extras

from src.reports.business_health_report import generate_report
from src.reports.storage import ensure_bucket_exists, upload_file

WINDOWS = {"weekly": 7, "monthly": 30}


def _store_today(conn, client_id: str):
    cur = conn.cursor()
    cur.execute("SELECT (now() AT TIME ZONE timezone)::date FROM clients WHERE client_id = %s;", (client_id,))
    row = cur.fetchone()
    cur.close()
    return row[0]


def generate_summaries(conn, client_id, display_name, supabase_url, service_role_key, columns=None, roas_thresholds=None) -> list[str]:
    """Returns one status string per window. 'skipped' (no data yet) is
    not an error; an upload failure raises."""
    if not supabase_url or not service_role_key:
        return ["skipped (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set)"]

    today = _store_today(conn, client_id)
    out_dir = Path(tempfile.mkdtemp(prefix="summaries_"))
    ensure_bucket_exists(supabase_url, service_role_key)
    statuses = []
    for name, days in WINDOWS.items():
        since = today - timedelta(days=days - 1)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s AND report_date <= %s ORDER BY report_date;",
            (client_id, since, today),
        )
        rows = cur.fetchall()
        cur.close()
        if not rows:
            statuses.append(f"{name}: skipped (no data in the last {days} days)")
            continue
        path = out_dir / f"{name}.xlsx"
        generate_report(rows, f"{display_name} -- last {days} days", str(path), columns, roas_thresholds)
        upload_file(str(path), f"{client_id}/summary/{name}.xlsx", supabase_url, service_role_key)
        statuses.append(f"{name}: {len(rows)} days uploaded")
    return statuses
