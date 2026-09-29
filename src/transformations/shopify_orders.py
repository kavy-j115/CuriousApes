"""Transforms raw_shopify_orders (JSONB, as Shopify sent it) into the clean
orders + order_line_items tables (typed columns, ready for aggregation).

Re-running this for a client is always safe: each order is upserted, and its
line items are fully replaced (deleted then re-inserted) rather than diffed,
which keeps the logic simple — a removed/changed line item can't linger.
"""

import psycopg2
import psycopg2.extras


def transform_orders(conn, client_id: str) -> int:
    """Returns the number of orders transformed."""
    read_cur = conn.cursor()
    write_cur = conn.cursor()

    read_cur.execute(
        "SELECT shopify_order_id, raw_data FROM raw_shopify_orders WHERE client_id = %s;",
        (client_id,),
    )
    rows = read_cur.fetchall()

    for shopify_order_id, raw in rows:
        _upsert_customer(write_cur, client_id, raw.get("customer"))
        order_id = _upsert_order(write_cur, client_id, shopify_order_id, raw)
        _replace_line_items(write_cur, order_id, raw["lineItems"]["edges"])

    conn.commit()
    read_cur.close()
    write_cur.close()
    return len(rows)


def _money(price_set: dict) -> str:
    return price_set["shopMoney"]["amount"]


def _currency(price_set: dict) -> str:
    return price_set["shopMoney"]["currencyCode"]


def _upsert_customer(cur, client_id: str, customer: dict | None) -> None:
    if not customer:
        return  # guest checkout, no customer record to link
    shopify_customer_id = customer["id"].rsplit("/", 1)[-1]
    cur.execute(
        """
        INSERT INTO customers (client_id, shopify_customer_id, email, phone, first_name, last_name, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (client_id, shopify_customer_id) DO UPDATE SET
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            updated_at = now();
        """,
        (
            client_id,
            shopify_customer_id,
            customer.get("email"),
            customer.get("phone"),
            customer.get("firstName"),
            customer.get("lastName"),
        ),
    )


def _upsert_order(cur, client_id: str, shopify_order_id: int, raw: dict) -> int:
    customer = raw.get("customer")
    customer_id = customer["id"].rsplit("/", 1)[-1] if customer else None

    cur.execute(
        """
        INSERT INTO orders (
            client_id, shopify_order_id, order_number, created_at, updated_at,
            financial_status, fulfillment_status, currency,
            total_price, subtotal_price, total_discounts, total_refunded, customer_id
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
        RETURNING id;
        """,
        (
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
        ),
    )
    return cur.fetchone()[0]


def _replace_line_items(cur, order_id: int, line_item_edges: list) -> None:
    cur.execute("DELETE FROM order_line_items WHERE order_id = %s;", (order_id,))
    for edge in line_item_edges:
        node = edge["node"]
        cur.execute(
            """
            INSERT INTO order_line_items (order_id, sku, title, quantity, unit_price)
            VALUES (%s, %s, %s, %s, %s);
            """,
            (
                order_id,
                node.get("sku"),
                node["title"],
                node["quantity"],
                _money(node["originalUnitPriceSet"]),
            ),
        )
