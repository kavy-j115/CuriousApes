"""Re-renders the report pictures (month to date, last 7 days, yesterday) for one or all clients
and stores them, WITHOUT fetching anything from Shopify or Meta and WITHOUT sending any message.

The daily run does this anyway; use this after changing something that only affects how the
pictures look (the header colour, columns) when you want the stored pictures --
the ones the WhatsApp bot answers with -- to change right away instead of at the next 9 AM run.

Run with: venv/Scripts/python scripts/render_report_images.py [--client ID]
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / "web" / ".env.local")

from src.config.clients import load_all
from src.reports.whatsapp_reports import render_and_store_views


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", help="one client id (default: every active client)")
    args = parser.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.")
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    for config in load_all(conn):
        cid = config["client_id"]
        if args.client and cid != args.client:
            continue
        if "paused" not in config or config.get("paused"):
            continue
        cur.execute("SELECT report_config FROM clients WHERE client_id = %s;", (cid,))
        report_config = cur.fetchone()[0]
        views = render_and_store_views(conn, cid, config.get("display_name", cid), report_config, url, key)
        print(f"{cid}: {', '.join(views) or 'no data'}")


if __name__ == "__main__":
    main()
