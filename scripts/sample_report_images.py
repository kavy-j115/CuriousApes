"""Uploads report PNGs built from MADE-UP numbers for one client, so the
WhatsApp bot can be tested without syncing real data. The title says
"SAMPLE DATA"; the next real pipeline run overwrites these files.

Touches only Supabase Storage (<client_id>/png/*.png). Fetches nothing from
Shopify/Meta/GA4 and sends nothing.

Run with: venv/Scripts/python scripts/sample_report_images.py <client_id>
"""

import os
import random
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg2
from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "web" / ".env.local")

from src.reports.report_image import render_report_png
from src.reports.storage import ensure_bucket_exists, upload_file
from src.reports.whatsapp_reports import VIEWS


def sample_rows(first: date, last: date) -> list[dict]:
    rng = random.Random(42)
    rows, mtd = [], 0.0
    day = first
    while day <= last:
        sessions = rng.randint(2500, 4500)
        carts = int(sessions * rng.uniform(0.10, 0.16))
        orders = int(sessions * rng.uniform(0.015, 0.03))
        gross = orders * rng.uniform(1100, 1700)
        spend = rng.uniform(15000, 30000)
        pv = spend * rng.uniform(2.0, 4.5)
        mtd += gross
        rows.append(dict(
            report_date=day, sessions=sessions, add_to_carts=carts, order_count=orders,
            gross_revenue=round(gross, 2), aov=round(gross / orders, 2) if orders else None,
            amount_spent=round(spend, 2), purchase_value=round(pv, 2), proas=round(pv / spend, 2),
            atc_pct=carts / sessions, conversion_pct=orders / sessions, checkout_pct=orders / carts,
            mtd_sale=round(mtd, 2), lmtd_sale=round(mtd * rng.uniform(0.8, 1.1), 2),
        ))
        day += timedelta(days=1)
    return rows


def main():
    if len(sys.argv) != 2:
        print("Usage: sample_report_images.py <client_id>")
        sys.exit(1)
    client_id = sys.argv[1]

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        "SELECT display_name, report_config, (now() AT TIME ZONE timezone)::date FROM clients WHERE client_id = %s;",
        (client_id,),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        print(f"No client '{client_id}'.")
        sys.exit(1)
    display_name, report_config, today = row

    supabase_url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    ensure_bucket_exists(supabase_url, key)

    month_start = today.replace(day=1)
    all_rows = sample_rows(min(month_start, today - timedelta(days=6)), today)
    by_view = {
        "mtd": [r for r in all_rows if r["report_date"] >= month_start],
        "7d": [r for r in all_rows if r["report_date"] >= today - timedelta(days=6)],
        "yesterday": [r for r in all_rows if r["report_date"] == today - timedelta(days=1)],
    }
    with tempfile.TemporaryDirectory() as tmp:
        for view, label in VIEWS.items():
            rows = by_view[view]
            if not rows:
                continue
            path = os.path.join(tmp, f"{view}.png")
            render_report_png(rows, f"{display_name} - {label} (SAMPLE DATA)", path, report_config)
            upload_file(path, f"{client_id}/png/{view}.png", supabase_url, key, content_type="image/png")
            print(f"uploaded {view} ({len(rows)} day(s))")


if __name__ == "__main__":
    main()
