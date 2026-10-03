"""Report pictures for WhatsApp: renders each client's report as PNGs,
stores them in Supabase Storage, and pushes the daily one to the client's
registered numbers.

Three views are rendered after every pipeline run and overwritten in place
at <client_id>/png/<view>.png:
  mtd        month to date (the Business Health Report format) -- the default
  7d         last 7 days
  yesterday  yesterday only
The WhatsApp bot (web/src/app/api/whatsapp/webhook) answers client messages
by sending the stored picture, so replies are instant and need no rendering.
"""

import os
import tempfile
from datetime import timedelta

import psycopg2.extras

from src.notifications.whatsapp import send_whatsapp_report_image
from src.reports.report_image import render_report_png
from src.reports.storage import ensure_bucket_exists, upload_file, create_signed_url

VIEWS = {"mtd": "Month to date", "7d": "Last 7 days", "yesterday": "Yesterday"}


def _view_rows(conn, client_id: str, view: str) -> list[dict]:
    cur = conn.cursor()
    cur.execute("SELECT (now() AT TIME ZONE timezone)::date FROM clients WHERE client_id = %s;", (client_id,))
    today = cur.fetchone()[0]
    cur.close()
    if view == "mtd":
        start, end = today.replace(day=1), today
    elif view == "7d":
        start, end = today - timedelta(days=6), today
    else:
        start = end = today - timedelta(days=1)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s AND report_date <= %s ORDER BY report_date;",
        (client_id, start, end),
    )
    rows = cur.fetchall()
    cur.close()
    return rows


def render_and_store_views(
    conn, client_id: str, display_name: str, report_config: dict | None, supabase_url: str, service_role_key: str
) -> list[str]:
    """Returns the views that were rendered (a view with no data is skipped)."""
    ensure_bucket_exists(supabase_url, service_role_key)
    done = []
    with tempfile.TemporaryDirectory() as tmp:
        for view, label in VIEWS.items():
            rows = _view_rows(conn, client_id, view)
            if not rows:
                continue
            path = os.path.join(tmp, f"{view}.png")
            render_report_png(rows, f"{display_name} - {label}", path, report_config)
            upload_file(path, f"{client_id}/png/{view}.png", supabase_url, service_role_key, content_type="image/png")
            done.append(view)
    return done


def push_daily_report(
    client_id: str, display_name: str, recipients: list[str], whatsapp_config: dict,
    supabase_url: str, service_role_key: str,
) -> tuple[int, list[str]]:
    """Sends the stored month-to-date picture to every recipient. Returns
    (sent count, per-recipient error strings) -- one bad number doesn't stop
    the others."""
    image_url = create_signed_url(supabase_url, service_role_key, f"{client_id}/png/mtd.png", expires_in=3600)
    caption = f"{display_name} - month-to-date report"
    sent, errors = 0, []
    for phone in recipients:
        try:
            send_whatsapp_report_image(whatsapp_config, phone, caption, image_url)
            sent += 1
        except Exception as e:
            errors.append(f"{phone}: {e}")
    return sent, errors
