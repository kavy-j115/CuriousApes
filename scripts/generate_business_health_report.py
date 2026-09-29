"""Generates the Business Health Report .xlsx for one client.
Run with: venv/Scripts/python scripts/generate_business_health_report.py
"""

import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

from src.reports.business_health_report import generate_report

load_dotenv()

CLIENT_ID = "dev_test"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "reports" / "output"


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("SELECT display_name FROM clients WHERE client_id = %s;", (CLIENT_ID,))
    client = cur.fetchone()
    if not client:
        print(f"No client '{CLIENT_ID}' found.")
        return

    since = date.today() - timedelta(days=28)
    until = date.today()
    cur.execute(
        "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date BETWEEN %s AND %s ORDER BY report_date;",
        (CLIENT_ID, since, until),
    )
    rows = cur.fetchall()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{CLIENT_ID}_business_health_report.xlsx"
    generate_report(rows, client["display_name"], str(output_path))

    print(f"Wrote {len(rows)} rows to {output_path}")
    conn.close()


if __name__ == "__main__":
    main()
