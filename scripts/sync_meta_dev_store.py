"""Runs a Meta Ads insights sync for the dev/test account.
Run with: venv/Scripts/python scripts/sync_meta_dev_store.py
"""

import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

from src.ingestion.meta_insights import sync_insights

load_dotenv()

CLIENT_ID = "dev_test"


def main():
    ad_account_id = os.environ["META_AD_ACCOUNT_ID"]
    access_token = os.environ["META_ACCESS_TOKEN"]

    since = (date.today() - timedelta(days=28)).isoformat()
    until = date.today().isoformat()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])

    print(f"Syncing Meta insights for act_{ad_account_id}, {since} to {until} ...")
    count = sync_insights(conn, CLIENT_ID, ad_account_id, access_token, since, until)
    print(f"Synced {count} daily rows into raw_meta_insights.")
    if count == 0:
        print("(0 is expected for a fresh test ad account with no ad delivery yet.)")

    conn.close()


if __name__ == "__main__":
    main()
