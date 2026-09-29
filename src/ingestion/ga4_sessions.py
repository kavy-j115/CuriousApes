"""Pulls daily session/ecommerce metrics from GA4 for one client and writes
them into raw_ga4_sessions. Upserts on (client_id, property_id, session_date).

UNVERIFIED AGAINST A LIVE ACCOUNT -- see src/connectors/ga4.py and
docs/connectors.md.
"""

from datetime import datetime

import psycopg2.extras

from src.connectors.ga4 import fetch_daily_ecommerce_metrics


def sync_sessions(conn, client_id: str, property_id: str, service_account_file: str, since: str, until: str) -> int:
    """Returns the number of daily rows written."""
    cur = conn.cursor()
    count = 0

    for row in fetch_daily_ecommerce_metrics(property_id, service_account_file, since, until):
        session_date = datetime.strptime(row["date"], "%Y%m%d").date()

        cur.execute(
            """
            INSERT INTO raw_ga4_sessions (client_id, property_id, session_date, raw_data, fetched_at)
            VALUES (%s, %s, %s, %s, now())
            ON CONFLICT (client_id, property_id, session_date)
            DO UPDATE SET raw_data = EXCLUDED.raw_data, fetched_at = now();
            """,
            (client_id, property_id, session_date, psycopg2.extras.Json(row)),
        )
        count += 1

    conn.commit()
    cur.close()
    return count
