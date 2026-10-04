"""Transforms raw_shopify_orders (JSONB, as Shopify sent it) into the clean
orders + order_line_items tables (typed columns, ready for aggregation).

Re-running this for a client is always safe: each order is upserted, and its
line items are fully replaced (deleted then re-inserted) rather than diffed,
which keeps the logic simple -- a removed/changed line item can't linger.

Everything is written in batches (customers, orders, line items: one round trip
each per batch) because the database is far from the machine running the job.
"""

import psycopg2
import psycopg2.extras

BATCH_SIZE = 500


def transform_orders(conn, client_id: str, fetched_since=None) -> int:
    """Returns the number of orders transformed.

    fetched_since: only transform raw orders written at or after this time
    (the daily run passes its own start, so it handles just the orders it
    fetched). None transforms every stored order -- needed for a first
    backfill or after a change to this transform."""
    read_cur = conn.cursor()
    if fetched_since is None:
        read_cur.execute(
            "SELECT shopify_order_id, raw_data FROM raw_shopify_orders WHERE client_id = %s;",
            (client_id,),
        )
    else:
        read_cur.execute(
            "SELECT shopify_order_id, raw_data FROM raw_shopify_orders WHERE client_id = %s AND fetched_at >= %s;",
            (client_id, fetched_since),
        )
    rows = read_cur.fetchall()
    read_cur.close()

    cur = conn.cursor()
    for start in range(0, len(rows), BATCH_SIZE):
        _transform_batch(cur, client_id, rows[start:start + BATCH_SIZE])
        conn.commit()
    cur.close()
    return len(rows)


def _transform_batch(cur, client_id: str, chunk: list) -> None:
    # --- customers (one row per customer id; a later order's details win) ---
    customers: dict[str, tuple] = {}
    for _, raw in chunk:
        customer = raw.get("customer")
        if not customer:
            continue  # guest checkout, no customer record to link
        cid = customer["id"].rsplit("/", 1)[-1]
        customers[cid] = (
            client_id, cid, customer.get("email"), customer.get("phone"), customer.get("firstName"), customer.get("lastName"),
        )
    if customers:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO customers (client_id, shopify_customer_id, email, phone, first_name, last_name, updated_at)
            VALUES %s
            ON CONFLICT (client_id, shopify_customer_id) DO UPDATE SET
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                updated_at = now();
            """,
            list(customers.values()),
            template="(%s, %s, %s, %s, %s, %s, now())",
            page_size=BATCH_SIZE,
        )

    # --- orders ---
    orders: dict[int, tuple] = {}
    for shopify_order_id, raw in chunk:
        customer = raw.get("customer")
        customer_id = customer["id"].rsplit("/", 1)[-1] if customer else None
        orders[shopify_order_id] = (
            client_id,
            shopify_order_id,
            raw["name"],
            raw["createdAt"],
            raw["updatedAt"],
            raw.get("displayFinancialStatus"),
            raw.get("displayFulfillmentStatus"),
            _currency(raw["currentTotalPriceSet"]),
            _money(raw["currentTotalPriceSet"]),
            _money(raw["currentSubtotalPriceSet"]),
            _money(raw["totalDiscountsSet"]),
            _money(raw["totalRefundedSet"]),
            customer_id,
        )
    returned = psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO orders (
            client_id, shopify_order_id, order_number, created_at, updated_at,
            financial_status, fulfillment_status, currency,
            total_price, subtotal_price, total_discounts, total_refunded, customer_id
        ) VALUES %s
        ON CONFLICT (client_id, shopify_order_id) DO UPDATE SET
            order_number = EXCLUDED.order_number,
            updated_at = EXCLUDED.updated_at,
            financial_status = EXCLUDED.financial_status,
            fulfillment_status = EXCLUDED.fulfillment_status,
            total_price = EXCLUDED.total_price,
            subtotal_price = EXCLUDED.subtotal_price,
            total_discounts = EXCLUDED.total_discounts,
            total_refunded = EXCLUDED.total_refunded,
            customer_id = EXCLUDED.customer_id
        RETURNING shopify_order_id, id;
        """,
        list(orders.values()),
        page_size=len(orders),
        fetch=True,
    )
    id_by_shopify = {shopify_id: row_id for shopify_id, row_id in returned}

    # --- line items: replaced wholesale for these orders ---
    cur.execute("DELETE FROM order_line_items WHERE order_id = ANY(%s);", (list(id_by_shopify.values()),))
    items: list[tuple] = []
    for shopify_order_id, raw in chunk:
        order_id = id_by_shopify[shopify_order_id]
        for edge in raw["lineItems"]["edges"]:
            node = edge["node"]
            items.append((order_id, node.get("sku"), node["title"], node["quantity"], _money(node["originalUnitPriceSet"])))
    if items:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO order_line_items (order_id, sku, title, quantity, unit_price) VALUES %s;",
            items,
            page_size=BATCH_SIZE * 2,
        )


def _money(price_set: dict) -> str:
    return price_set["shopMoney"]["amount"]


def _currency(price_set: dict) -> str:
    return price_set["shopMoney"]["currencyCode"]
