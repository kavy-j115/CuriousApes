"""One-off script: confirms .env is readable and Postgres (Supabase) is reachable.
Run with: venv/Scripts/python scripts/test_db_connection.py
"""

import os
import sys

from dotenv import load_dotenv
import psycopg2

load_dotenv()

database_url = os.environ.get("DATABASE_URL")

if not database_url or "YOUR_PASSWORD" in database_url:
    print("DATABASE_URL is missing or still has the placeholder password. Check .env.")
    sys.exit(1)

try:
    conn = psycopg2.connect(database_url)
    cur = conn.cursor()
    cur.execute("SELECT version();")
    version = cur.fetchone()[0]
    cur.close()
    conn.close()
    print("Connected successfully.")
    print(f"Postgres version: {version}")
except Exception as e:
    print(f"Connection failed: {e}")
    sys.exit(1)
