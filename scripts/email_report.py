"""Manually emails a client's Business Health Report.

Run with:
  venv/Scripts/python scripts/email_report.py --client <client_id> [--days 7] [--to a@b.com] [--dry-run]

Reads ONLY our own database (daily_report_metrics) -- it never calls Shopify,
Meta or GA4, so it is safe to run any time; the data in the email is whatever
the last sync already stored. Recipients default to the client's
email_recipients (set in the admin Clients page). --dry-run builds
everything and writes a preview, but sends nothing.
"""

import argparse
import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

from src.config.report_config import load_report_config
from src.notifications.email import build_summary, load_email_config, send_report_email
from src.reports.business_health_report import generate_report
from src.reports.report_columns import resolve_columns

load_dotenv()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--to", help="comma-separated; overrides the client's email_recipients")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT display_name, email_recipients FROM clients WHERE client_id = %s;", (args.client,))
    client = cur.fetchone()
    if not client:
        sys.exit(f"No client '{args.client}'.")

    recipients = [a.strip() for a in args.to.split(",")] if args.to else list(client["email_recipients"] or [])
    if not recipients:
        sys.exit("No recipients: set email recipients on the client, or pass --to.")

    since = (date.today() - timedelta(days=args.days)).isoformat()
    cur.execute(
        "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s ORDER BY report_date;",
        (args.client, since),
    )
    rows = cur.fetchall()
    if not rows:
        sys.exit(f"No report rows for '{args.client}' since {since} -- has a sync run for this client yet?")

    report_config = load_report_config(conn, args.client)
    columns = resolve_columns(report_config)
    out_dir = Path(tempfile.mkdtemp(prefix="email_report_"))
    xlsx = out_dir / f"{args.client}_business_health_report.xlsx"
    generate_report(rows, client["display_name"], str(xlsx), report_config)

    html_body, text_body = build_summary(rows, columns, client["display_name"])
    subject = f"{client['display_name']} - Business Health Report"

    if args.dry_run:
        preview = out_dir / "preview.html"
        preview.write_text(html_body, encoding="utf-8")
        print(
            f"DRY RUN - nothing sent.\n  to: {', '.join(recipients)}\n  subject: {subject}\n"
            f"  rows: {len(rows)}\n  attachment: {xlsx}\n  preview: {preview}"
        )
        return

    config = load_email_config(conn)
    if config is None:
        sys.exit("Sending mailbox is not set up: store agency.email.smtp_user and agency.email.smtp_password in Vault.")
    send_report_email(config, recipients, subject, html_body, text_body, xlsx)
    print(f"Sent '{subject}' to {', '.join(recipients)} ({len(rows)} rows).")


if __name__ == "__main__":
    main()
