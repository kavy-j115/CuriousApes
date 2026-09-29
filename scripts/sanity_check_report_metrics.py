"""Quick correctness check for daily_report_metrics (MTD/LMTD + cross-source
ratios) against hand-computed expected values. Not a permanent test --
inserts synthetic rows directly into the clean/raw layers, checks the view,
then deletes everything it created.
Run with: venv/Scripts/python scripts/sanity_check_report_metrics.py
"""

import os

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

load_dotenv()

TEST_CLIENT = "_sanity_check_report"

conn = psycopg2.connect(os.environ["DATABASE_URL"])
conn.autocommit = False
cur = conn.cursor()

try:
    cur.execute(
        "INSERT INTO clients (client_id, display_name) VALUES (%s, %s);",
        (TEST_CLIENT, "Sanity Check Report"),
    )

    # August orders (previous month) -- feeds LMTD
    orders = [
        # (shopify_order_id, date, total_price, order_count contribution = 1 row = 1 order)
        (9001, "2026-08-15", 100.00),
        (9002, "2026-08-16", 50.00),
        # September orders (current month) -- feeds MTD
        (9003, "2026-09-15", 200.00),
        (9004, "2026-09-16", 80.00),
    ]
    for order_id, order_date, price in orders:
        cur.execute(
            """
            INSERT INTO orders (client_id, shopify_order_id, order_number, created_at, updated_at,
                financial_status, currency, total_price, subtotal_price, total_discounts, total_refunded)
            VALUES (%s, %s, %s, %s, %s, 'PAID', 'USD', %s, %s, 0, 0);
            """,
            (TEST_CLIENT, order_id, f"#{order_id}", order_date, order_date, price, price),
        )

    # GA4 + Meta rows for the two September dates, to check the cross-source ratios
    ga4_rows = [
        ("2026-09-15", 1000, 100, 50),
        ("2026-09-16", 500, 40, 20),
    ]
    for session_date, sessions, add_to_carts, checkouts in ga4_rows:
        cur.execute(
            """
            INSERT INTO raw_ga4_sessions (client_id, property_id, session_date, raw_data)
            VALUES (%s, 'test-property', %s, %s);
            """,
            (TEST_CLIENT, session_date, psycopg2.extras.Json({
                "sessions": sessions, "addToCarts": add_to_carts, "checkouts": checkouts,
            })),
        )

    meta_rows = [
        ("2026-09-15", 500.00, 3, 200.00),
        ("2026-09-16", 300.00, 1, 80.00),
    ]
    for insight_date, spend, purchases, purchase_value in meta_rows:
        cur.execute(
            """
            INSERT INTO raw_meta_insights (client_id, ad_account_id, insight_date, raw_data)
            VALUES (%s, 'test-account', %s, %s);
            """,
            (TEST_CLIENT, insight_date, psycopg2.extras.Json({
                "spend": str(spend),
                "actions": [{"action_type": "purchase", "value": str(purchases)}],
                "action_values": [{"action_type": "purchase", "value": str(purchase_value)}],
            })),
        )

    cur.execute(
        "SELECT report_date, gross_revenue, mtd_sale, lmtd_sale, atc_pct, conversion_pct, checkout_pct, proas "
        "FROM daily_report_metrics WHERE client_id = %s ORDER BY report_date;",
        (TEST_CLIENT,),
    )
    rows = {str(r[0]): r for r in cur.fetchall()}

    # --- Assertions against hand-calculated expected values ---
    sep15 = rows["2026-09-15"]
    assert sep15[2] == 200, f"MTD for 09-15 should be 200, got {sep15[2]}"          # mtd_sale
    assert sep15[3] == 100, f"LMTD for 09-15 should be 100, got {sep15[3]}"          # lmtd_sale
    assert round(float(sep15[4]), 3) == 0.1, f"ATC% should be 0.1, got {sep15[4]}"   # 100/1000
    assert round(float(sep15[5]), 3) == 0.001, f"Conversion% should be 0.001, got {sep15[5]}"  # 1 Shopify order/1000 sessions
    assert round(float(sep15[6]), 3) == 0.05, f"Checkout% should be 0.05, got {sep15[6]}"  # 50/1000
    assert round(float(sep15[7]), 3) == 0.4, f"PROAS should be 0.4, got {sep15[7]}"  # 200/500
    print("PASS: 09-15 MTD/LMTD/ATC%/Conversion%/Checkout%/PROAS all match hand-calculated values")

    sep16 = rows["2026-09-16"]
    assert sep16[2] == 280, f"MTD for 09-16 should be 280 (200+80), got {sep16[2]}"
    assert sep16[3] == 150, f"LMTD for 09-16 should be 150 (100+50), got {sep16[3]}"
    print("PASS: 09-16 cumulative MTD/LMTD correctly carries the running total forward")

finally:
    cur.execute("DELETE FROM raw_meta_insights WHERE client_id = %s;", (TEST_CLIENT,))
    cur.execute("DELETE FROM raw_ga4_sessions WHERE client_id = %s;", (TEST_CLIENT,))
    cur.execute("DELETE FROM order_line_items WHERE order_id IN (SELECT id FROM orders WHERE client_id = %s);", (TEST_CLIENT,))
    cur.execute("DELETE FROM orders WHERE client_id = %s;", (TEST_CLIENT,))
    cur.execute("DELETE FROM raw_shopify_orders WHERE client_id = %s;", (TEST_CLIENT,))
    cur.execute("DELETE FROM clients WHERE client_id = %s;", (TEST_CLIENT,))
    conn.commit()
    cur.close()
    conn.close()
    print("cleaned up test data.")
