"""Applies any .sql files in sql/ that haven't been run against this database yet.
Run with: venv/Scripts/python scripts/migrate.py
"""

import os
from pathlib import Path

from dotenv import load_dotenv
import psycopg2

load_dotenv()

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename    TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    conn.commit()

    cur.execute("SELECT filename FROM schema_migrations;")
    already_applied = {row[0] for row in cur.fetchall()}

    sql_files = sorted(SQL_DIR.glob("*.sql"))

    for path in sql_files:
        if path.name in already_applied:
            print(f"skip   {path.name} (already applied)")
            continue

        print(f"apply  {path.name}")
        sql = path.read_text()
        try:
            cur.execute(sql)
            cur.execute("INSERT INTO schema_migrations (filename) VALUES (%s);", (path.name,))
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    cur.close()
    conn.close()
    print("done.")


if __name__ == "__main__":
    main()
