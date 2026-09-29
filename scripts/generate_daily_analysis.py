"""Generates and saves the AI Analyst's daily report for one client.
Run with: venv/Scripts/python scripts/generate_daily_analysis.py --client dev_test
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

from src.ai.daily_analyst import get_metrics_for_analysis, generate_daily_analysis, save_report

load_dotenv()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", required=True)
    args = parser.parse_args()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])

    cur = conn.cursor()
    cur.execute("SELECT display_name FROM clients WHERE client_id = %s;", (args.client,))
    row = cur.fetchone()
    if not row:
        print(f"No client '{args.client}' found.")
        return
    display_name = row[0]
    cur.close()

    today_row, trailing_rows = get_metrics_for_analysis(conn, args.client)
    if not today_row:
        print(f"No data at all for '{args.client}' -- nothing to analyze.")
        return

    print(f"Generating analysis for {display_name} ({today_row['report_date']}, {len(trailing_rows)} trailing days of context)...")
    analysis = generate_daily_analysis(display_name, today_row, trailing_rows)

    save_report(conn, args.client, today_row["report_date"], analysis)
    print(f"\nSaved to ai_daily_reports.\n{'-' * 40}\n{analysis}")

    conn.close()


if __name__ == "__main__":
    main()
