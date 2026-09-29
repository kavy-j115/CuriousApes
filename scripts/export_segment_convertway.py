"""Exports a "last order X-Y days ago" customer segment to a ConvertWay-ready
CSV. Not full automation -- produces a file for you to review and upload to
ConvertWay yourself.

Run with:
venv/Scripts/python scripts/export_segment_convertway.py --client dev_test --min-days 60 --max-days 90
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

from src.analytics.customer_segments import get_customers_by_last_order_window
from src.reports.convertway_export import export_customers_to_csv

load_dotenv()

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "reports" / "output" / "segments"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", required=True, help="client_id, e.g. dev_test")
    parser.add_argument("--min-days", type=int, required=True, help="closer edge of the window, e.g. 60")
    parser.add_argument("--max-days", type=int, required=True, help="further edge of the window, e.g. 90")
    args = parser.parse_args()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    customers = get_customers_by_last_order_window(conn, args.client, args.min_days, args.max_days)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{args.client}_winback_{args.min_days}_{args.max_days}d.csv"
    counts = export_customers_to_csv(customers, str(output_path))

    print(f"Segment: last order {args.min_days}-{args.max_days} days ago")
    print(f"  matched:              {len(customers)}")
    print(f"  exported:             {counts['exported']} -> {output_path}")
    print(f"  skipped (no phone):   {counts['skipped_no_phone']}")
    print(f"  skipped (bad phone):  {counts['skipped_invalid_phone']}")

    conn.close()


if __name__ == "__main__":
    main()
