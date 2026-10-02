"""Pulls orders from Shopify for one client and writes them into raw_shopify_orders.

Upserts on (client_id, shopify_order_id): re-running this is always safe,
whether it's the first backfill or the hundredth daily sync.
"""

import psycopg2
import psycopg2.extras

from src.connectors.shopify import fetch_orders


def sync_orders(conn, client_id: str, store_domain: str, access_token: str, created_at_min: str | None = None) -> int:
    """Returns the number of orders written."""
    cur = conn.cursor()
    count = 0

    for order in fetch_orders(store_domain, access_token, created_at_min):
        shopify_order_id = order["id"]  # Shopify's GraphQL global ID, e.g. "gid://shopify/Order/123"

        cur.execute(
            """
            INSERT INTO raw_shopify_orders (client_id, shopify_order_id, raw_data, fetched_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (client_id, shopify_order_id)
            DO UPDATE SET raw_data = EXCLUDED.raw_data, fetched_at = now();
            """,
            (client_id, _numeric_id(shopify_order_id), psycopg2.extras.Json(order)),
        )
        count += 1

    conn.commit()
    cur.close()
    return count


def _numeric_id(gid: str) -> int:
    """Shopify's GraphQL IDs look like 'gid://shopify/Order/123456'.
    We store just the numeric part — it's what REST used to give us directly,
    and it's what we'll actually filter/join on later."""
    return int(gid.rsplit("/", 1)[-1])
