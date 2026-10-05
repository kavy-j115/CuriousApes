"""Stores Shopify's own daily sales (and, for clients without GA4, sessions)
in shopify_daily_sales / shopify_daily_sessions. Upserts per (client, day):
re-running a window is always safe and simply refreshes it.
"""

import psycopg2.extras

from src.connectors.shopify_analytics import fetch_daily_sales, fetch_daily_sessions, fetch_landing_page_sessions


def sync_shopify_analytics(conn, client_id: str, store_domain: str, access_token: str, since: str, until: str, include_sessions: bool) -> tuple[int, int]:
    """Returns (sales_days, session_days) written. include_sessions is False
    for clients that have their own GA4 property (GA4 is used for sessions
    there)."""
    sales = fetch_daily_sales(store_domain, access_token, since, until)

    cur = conn.cursor()
    for r in sales:
        cur.execute(
            """
            INSERT INTO shopify_daily_sales
                (client_id, report_date, orders, gross_sales, discounts, returns, net_sales, shipping_charges, taxes, total_sales, fetched_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (client_id, report_date) DO UPDATE SET
                orders = EXCLUDED.orders, gross_sales = EXCLUDED.gross_sales, discounts = EXCLUDED.discounts,
                returns = EXCLUDED.returns, net_sales = EXCLUDED.net_sales, shipping_charges = EXCLUDED.shipping_charges,
                taxes = EXCLUDED.taxes, total_sales = EXCLUDED.total_sales, fetched_at = now();
            """,
            (client_id, r["report_date"], r["orders"], r["gross_sales"], r["discounts"], r["returns"],
             r["net_sales"], r["shipping_charges"], r["taxes"], r["total_sales"]),
        )
    # Sales are saved before sessions are fetched, so a problem with the sessions
    # query can't throw away the sales that already came back.
    conn.commit()
    sessions = fetch_daily_sessions(store_domain, access_token, since, until) if include_sessions else []
    for r in sessions:
        cur.execute(
            """
            INSERT INTO shopify_daily_sessions (client_id, report_date, sessions, added_to_cart, reached_checkout, fetched_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (client_id, report_date) DO UPDATE SET
                sessions = EXCLUDED.sessions, added_to_cart = EXCLUDED.added_to_cart,
                reached_checkout = EXCLUDED.reached_checkout, fetched_at = now();
            """,
            (client_id, r["report_date"], r["sessions"], r["added_to_cart"], r["reached_checkout"]),
        )
    conn.commit()
    cur.close()
    return len(sales), len(sessions)


def sync_landing_pages(conn, client_id: str, store_domain: str, access_token: str, since: str, until: str) -> int:
    """Stores sessions per landing page and month (shopify_landing_page_sessions).
    Upserts per (client, month, page): re-running a window just refreshes it."""
    rows = fetch_landing_page_sessions(store_domain, access_token, since, until)
    if not rows:
        return 0
    cur = conn.cursor()
    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO shopify_landing_page_sessions
            (client_id, month, landing_page_path, sessions, sessions_with_cart_additions, fetched_at)
        VALUES %s
        ON CONFLICT (client_id, month, landing_page_path) DO UPDATE SET
            sessions = EXCLUDED.sessions,
            sessions_with_cart_additions = EXCLUDED.sessions_with_cart_additions,
            fetched_at = now();
        """,
        [(client_id, r["month"], r["landing_page_path"], r["sessions"], r["sessions_with_cart_additions"]) for r in rows],
        template="(%s, %s, %s, %s, %s, now())",
    )
    conn.commit()
    cur.close()
    return len(rows)
