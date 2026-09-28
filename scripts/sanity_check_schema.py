"""Quick correctness check for sql/001_initial_schema.sql — not a permanent test,
just proves the constraints behave as designed, then cleans up after itself.
Run with: venv/Scripts/python scripts/sanity_check_schema.py
"""

import os

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

load_dotenv()

conn = psycopg2.connect(os.environ["DATABASE_URL"])
conn.autocommit = False
cur = conn.cursor()

TEST_CLIENT = "_sanity_check_brand"

try:
    # 1. Insert a client, then a raw order for it with a JSONB payload.
    cur.execute(
        "INSERT INTO clients (client_id, display_name) VALUES (%s, %s);",
        (TEST_CLIENT, "Sanity Check Brand"),
    )
    cur.execute(
        "INSERT INTO raw_shopify_orders (client_id, shopify_order_id, raw_data) VALUES (%s, %s, %s);",
        (TEST_CLIENT, 1001, psycopg2.extras.Json({"total_price": "49.99", "currency": "USD"})),
    )

    # 2. Read it back, pulling one field out of the JSONB column.
    cur.execute(
        "SELECT raw_data->>'total_price' FROM raw_shopify_orders WHERE client_id = %s AND shopify_order_id = %s;",
        (TEST_CLIENT, 1001),
    )
    price = cur.fetchone()[0]
    assert price == "49.99", f"expected 49.99, got {price}"
    print("PASS: insert + JSONB field read")

    # 3. Confirm the UNIQUE constraint blocks a duplicate (client_id, shopify_order_id).
    try:
        cur.execute(
            "INSERT INTO raw_shopify_orders (client_id, shopify_order_id, raw_data) VALUES (%s, %s, %s);",
            (TEST_CLIENT, 1001, psycopg2.extras.Json({})),
        )
        print("FAIL: duplicate order was allowed")
    except psycopg2.errors.UniqueViolation:
        conn.rollback()  # this rollback undoes step 1+2 too, so redo them below
        print("PASS: duplicate (client_id, shopify_order_id) correctly rejected")
        cur.execute(
            "INSERT INTO clients (client_id, display_name) VALUES (%s, %s);",
            (TEST_CLIENT, "Sanity Check Brand"),
        )
        cur.execute(
            "INSERT INTO raw_shopify_orders (client_id, shopify_order_id, raw_data) VALUES (%s, %s, %s);",
            (TEST_CLIENT, 1001, psycopg2.extras.Json({"total_price": "49.99"})),
        )

    # 4. Confirm the FK constraint blocks an order for a client that doesn't exist.
    try:
        cur.execute(
            "INSERT INTO raw_shopify_orders (client_id, shopify_order_id, raw_data) VALUES (%s, %s, %s);",
            ("_nonexistent_brand", 9999, psycopg2.extras.Json({})),
        )
        print("FAIL: order for nonexistent client was allowed")
    except psycopg2.errors.ForeignKeyViolation:
        conn.rollback()
        print("PASS: foreign key correctly rejected unknown client_id")
        # redo the valid rows again since rollback undid them
        cur.execute(
            "INSERT INTO clients (client_id, display_name) VALUES (%s, %s) ON CONFLICT DO NOTHING;",
            (TEST_CLIENT, "Sanity Check Brand"),
        )
        cur.execute(
            "INSERT INTO raw_shopify_orders (client_id, shopify_order_id, raw_data) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING;",
            (TEST_CLIENT, 1001, psycopg2.extras.Json({"total_price": "49.99"})),
        )

finally:
    # Clean up test data regardless of outcome above.
    cur.execute("DELETE FROM raw_shopify_orders WHERE client_id = %s;", (TEST_CLIENT,))
    cur.execute("DELETE FROM clients WHERE client_id = %s;", (TEST_CLIENT,))
    conn.commit()
    cur.close()
    conn.close()
    print("cleaned up test data.")
