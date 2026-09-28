"""Runs a full Shopify order sync for the dev/test store.
Run with: venv/Scripts/python scripts/sync_shopify_dev_store.py
"""

import os
import sys
from pathlib import Path

# Allows "from src...." imports when running this script directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

from src.ingestion.shopify_orders import sync_orders

load_dotenv()

CLIENT_ID = "dev_test"


def main():
    store_domain = os.environ["SHOPIFY_STORE_DOMAIN"]
    access_token = os.environ["SHOPIFY_ACCESS_TOKEN"]

    conn = psycopg2.connect(os.environ["DATABASE_URL"])

    # Make sure the client row exists before we insert orders that reference it.
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO clients (client_id, display_name) VALUES (%s, %s) ON CONFLICT DO NOTHING;",
        (CLIENT_ID, "Dev/Test Store"),
    )
    conn.commit()
    cur.close()

    print(f"Syncing orders from {store_domain} ...")
    count = sync_orders(conn, CLIENT_ID, store_domain, access_token)
    print(f"Synced {count} orders into raw_shopify_orders.")

    conn.close()


if __name__ == "__main__":
    main()
