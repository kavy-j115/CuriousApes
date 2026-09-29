"""Pulls daily ad insights from Meta for one client and writes them into
raw_meta_insights. Upserts on (client_id, ad_account_id, insight_date)."""

import psycopg2.extras

from src.connectors.meta_ads import fetch_daily_insights


def sync_insights(conn, client_id: str, ad_account_id: str, access_token: str, since: str, until: str) -> int:
    """Returns the number of daily rows written."""
    cur = conn.cursor()
    count = 0

    for row in fetch_daily_insights(ad_account_id, access_token, since, until):
        insight_date = row["date_start"]  # 'YYYY-MM-DD', present because time_increment=1

        cur.execute(
            """
            INSERT INTO raw_meta_insights (client_id, ad_account_id, insight_date, raw_data, fetched_at)
            VALUES (%s, %s, %s, %s, now())
            ON CONFLICT (client_id, ad_account_id, insight_date)
            DO UPDATE SET raw_data = EXCLUDED.raw_data, fetched_at = now();
            """,
            (client_id, ad_account_id, insight_date, psycopg2.extras.Json(row)),
        )
        count += 1

    conn.commit()
    cur.close()
    return count
