"""Pulls orders from Shopify for one client and writes them into raw_shopify_orders.

Upserts on (client_id, shopify_order_id): re-running this is always safe,
whether it's the first backfill or the hundredth daily sync.

Orders are written in batches (one database round trip per batch, not per
order) -- the database is far from the machine running the job, so per-order
writes were the main reason a 60-day backfill took ~16 minutes.
"""

import psycopg2
import psycopg2.extras

from src.connectors.shopify import fetch_orders, fetch_orders_bulk

BATCH_SIZE = 250


def sync_orders(conn, client_id: str, store_domain: str, access_token: str, created_at_min: str | None = None, bulk: bool = False) -> int:
    """Returns the number of orders written. bulk=True uses Shopify's bulk export
    (for a big backfill); if that fails it falls back to normal paging."""
    cur = conn.cursor()
    count = 0
    batch: dict[int, tuple] = {}

    def flush() -> None:
        nonlocal count
        if not batch:
            return
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO raw_shopify_orders (client_id, shopify_order_id, raw_data, fetched_at)
            VALUES %s
            ON CONFLICT (client_id, shopify_order_id)
            DO UPDATE SET raw_data = EXCLUDED.raw_data, fetched_at = now();
            """,
            list(batch.values()),
            template="(%s, %s, %s, now())",
            page_size=BATCH_SIZE,
        )
        conn.commit()
        count += len(batch)
        batch.clear()

    def orders_iter():
        if bulk and created_at_min:
            try:
                yield from fetch_orders_bulk(store_domain, access_token, created_at_min)
                return
            except Exception as e:
                if batch or count:  # already writing: don't repeat orders half way
                    raise
                print(f"  bulk export failed ({e}); falling back to paging")
        yield from fetch_orders(store_domain, access_token, created_at_min)

    for order in orders_iter():
        order_id = _numeric_id(order["id"])  # Shopify's GraphQL global ID, e.g. "gid://shopify/Order/123"
        batch[order_id] = (client_id, order_id, psycopg2.extras.Json(order))
        if len(batch) >= BATCH_SIZE:
            flush()
    flush()

    cur.close()
    return count


def _numeric_id(gid: str) -> int:
    """Shopify's GraphQL IDs look like 'gid://shopify/Order/123456'.
    We store just the numeric part — it's what REST used to give us directly,
    and it's what we'll actually filter/join on later."""
    return int(gid.rsplit("/", 1)[-1])
