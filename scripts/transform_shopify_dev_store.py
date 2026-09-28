"""Transforms raw_shopify_orders into the clean orders/order_line_items tables
for the dev/test store.
Run with: venv/Scripts/python scripts/transform_shopify_dev_store.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

from src.transformations.shopify_orders import transform_orders

load_dotenv()

CLIENT_ID = "dev_test"


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    count = transform_orders(conn, CLIENT_ID)
    print(f"Transformed {count} orders.")
    conn.close()


if __name__ == "__main__":
    main()
