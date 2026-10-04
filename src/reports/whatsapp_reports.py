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

VIEWS = ["mtd", "7d", "yesterday"]


def _view_label(view: str, start, end) -> str:
    """Says exactly what period a picture covers, so a finished month is never
    mistaken for the new, still-empty one (on the 1st, "month to date" is the
    whole previous month)."""
    if view == "mtd":
        full_month = (end + timedelta(days=1)).day == 1
        return f"{end:%B %Y} - full month" if full_month else f"{end:%B %Y} - 1 to {end.day} {end:%b}"
    if view == "7d":
        return f"Last 7 days ({start:%d %b} - {end:%d %b})"
    return f"{end:%d %b %Y}"


def _view_rows(conn, client_id: str, view: str) -> tuple[list[dict], str]:
    cur = conn.cursor()
    cur.execute("SELECT (now() AT TIME ZONE timezone)::date FROM clients WHERE client_id = %s;", (client_id,))
    # Completed days only: the store's current day is left out until it is whole.
    last = cur.fetchone()[0] - timedelta(days=1)
    cur.close()
    if view == "mtd":
        start, end = last.replace(day=1), last
    elif view == "7d":
        start, end = last - timedelta(days=6), last
    else:
        start = end = last
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s AND report_date <= %s ORDER BY report_date;",
        (client_id, start, end),
    )
    rows = cur.fetchall()
    cur.close()
    return rows, _view_label(view, start, end)


def render_and_store_views(
    conn, client_id: str, display_name: str, report_config: dict | None, supabase_url: str, service_role_key: str
) -> dict[str, str]:
    """Returns {view: period label} for the views that were rendered (a view
    with no data is skipped)."""
    ensure_bucket_exists(supabase_url, service_role_key)
    done: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for view in VIEWS:
            rows, label = _view_rows(conn, client_id, view)
            if not rows:
                continue
            path = os.path.join(tmp, f"{view}.png")
            render_report_png(rows, f"{display_name} - {label}", path, report_config)
            upload_file(path, f"{client_id}/png/{view}.png", supabase_url, service_role_key, content_type="image/png")
            done[view] = label
    return done


def push_daily_report(
    client_id: str, display_name: str, recipients: list[str], whatsapp_config: dict,
    supabase_url: str, service_role_key: str, period_label: str = "monthly report", view: str = "mtd",
) -> tuple[int, list[str]]:
    """Sends the stored picture (month-to-date by default; "7d" for the weekly report) to every recipient. Returns
    (sent count, per-recipient error strings) -- one bad number doesn't stop
    the others."""
    image_url = create_signed_url(supabase_url, service_role_key, f"{client_id}/png/{view}.png", expires_in=3600)
    caption = f"{display_name} - {period_label}"
    sent, errors = 0, []
    for phone in recipients:
        try:
            send_whatsapp_report_image(whatsapp_config, phone, caption, image_url)
            sent += 1
        except Exception as e:
            errors.append(f"{phone}: {e}")
    return sent, errors
