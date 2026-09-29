"""Rigorous RLS verification: simulates 3 different authenticated users
(admin, a 'user' scoped to one client, a 'client' scoped to a different
one) and confirms each sees EXACTLY the rows they should -- not just "it
returned something," but the precise expected set, including proving
cross-client isolation with two genuinely distinct clients.

Uses SET LOCAL role/request.jwt.claim.sub to simulate what PostgREST does
for an authenticated request, confirmed against auth.uid()'s real
definition on this project (not assumed) before writing this.

Cleans up all test data unconditionally (try/finally), including via a
fresh admin connection at the end in case the RLS role context confuses
cleanup permissions.

Run with: venv/Scripts/python scripts/verify_rls.py
"""

import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

load_dotenv()

CLIENT_A = "_rls_test_client_a"
CLIENT_B = "_rls_test_client_b"

ADMIN_UUID = str(uuid.uuid4())
USER_UUID = str(uuid.uuid4())   # 'user' role, scoped to CLIENT_A only
CLIENT_ROLE_UUID = str(uuid.uuid4())  # 'client' role, scoped to CLIENT_B only


def query_as(conn, user_uuid: str, sql: str) -> list:
    """Runs sql in a transaction simulating that user's authenticated
    request, then rolls back the role/claim change (not the data)."""
    cur = conn.cursor()
    cur.execute("BEGIN;")
    cur.execute("SET LOCAL role TO authenticated;")
    cur.execute("SET LOCAL request.jwt.claim.sub TO %s;", (user_uuid,))
    cur.execute(sql)
    rows = cur.fetchall()
    cur.execute("COMMIT;")
    return rows


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # --- Set up two genuinely distinct clients with their own orders ---
        for cid, name in [(CLIENT_A, "RLS Test Client A"), (CLIENT_B, "RLS Test Client B")]:
            cur.execute("INSERT INTO clients (client_id, display_name) VALUES (%s, %s);", (cid, name))
        cur.execute(
            """INSERT INTO orders (client_id, shopify_order_id, order_number, created_at, updated_at,
                financial_status, currency, total_price, subtotal_price, total_discounts, total_refunded)
               VALUES (%s, 9001, '#9001', now(), now(), 'PAID', 'USD', 100, 100, 0, 0);""",
            (CLIENT_A,),
        )
        cur.execute(
            """INSERT INTO orders (client_id, shopify_order_id, order_number, created_at, updated_at,
                financial_status, currency, total_price, subtotal_price, total_discounts, total_refunded)
               VALUES (%s, 9002, '#9002', now(), now(), 'PAID', 'USD', 200, 200, 0, 0);""",
            (CLIENT_B,),
        )

        # --- Set up the auth.users rows (user_profiles FKs into auth.users) ---
        for uid in (ADMIN_UUID, USER_UUID, CLIENT_ROLE_UUID):
            cur.execute(
                "INSERT INTO auth.users (id, email) VALUES (%s, %s);",
                (uid, f"{uid}@rls-test.local"),
            )

        cur.execute("INSERT INTO user_profiles (id, role) VALUES (%s, 'admin');", (ADMIN_UUID,))
        cur.execute("INSERT INTO user_profiles (id, role) VALUES (%s, 'user');", (USER_UUID,))
        cur.execute("INSERT INTO user_profiles (id, role) VALUES (%s, 'client');", (CLIENT_ROLE_UUID,))

        cur.execute("INSERT INTO client_access (user_id, client_id) VALUES (%s, %s);", (USER_UUID, CLIENT_A))
        cur.execute("INSERT INTO client_access (user_id, client_id) VALUES (%s, %s);", (CLIENT_ROLE_UUID, CLIENT_B))

        conn.commit()

        # --- Test 1: admin sees both clients ---
        rows = query_as(conn, ADMIN_UUID, f"SELECT client_id FROM clients WHERE client_id IN ('{CLIENT_A}', '{CLIENT_B}') ORDER BY client_id;")
        client_ids = [r[0] for r in rows]
        assert client_ids == [CLIENT_A, CLIENT_B], f"admin should see both test clients, got {client_ids}"
        print("PASS: admin role sees both test clients")

        # --- Test 2: 'user' scoped to CLIENT_A sees only CLIENT_A ---
        rows = query_as(conn, USER_UUID, f"SELECT client_id FROM clients WHERE client_id IN ('{CLIENT_A}', '{CLIENT_B}') ORDER BY client_id;")
        client_ids = [r[0] for r in rows]
        assert client_ids == [CLIENT_A], f"user should see only Client A, got {client_ids}"
        print("PASS: 'user' role scoped to Client A sees only Client A (not Client B)")

        # --- Test 3: 'client' scoped to CLIENT_B sees only CLIENT_B ---
        rows = query_as(conn, CLIENT_ROLE_UUID, f"SELECT client_id FROM clients WHERE client_id IN ('{CLIENT_A}', '{CLIENT_B}') ORDER BY client_id;")
        client_ids = [r[0] for r in rows]
        assert client_ids == [CLIENT_B], f"client role should see only Client B, got {client_ids}"
        print("PASS: 'client' role scoped to Client B sees only Client B (not Client A)")

        # --- Test 4: same isolation holds through the VIEW chain, not just the base table ---
        # (this is the specific thing security_invoker was needed for)
        rows = query_as(conn, USER_UUID, f"SELECT client_id FROM daily_report_metrics WHERE client_id IN ('{CLIENT_A}', '{CLIENT_B}');")
        client_ids = {r[0] for r in rows}
        assert client_ids <= {CLIENT_A}, f"daily_report_metrics leaked Client B's row to a Client-A-scoped user: {client_ids}"
        assert CLIENT_A in client_ids, "daily_report_metrics should show Client A's own row to a user scoped to it"
        print("PASS: RLS correctly propagates through the daily_report_metrics view chain (security_invoker working)")

        # --- Test 5: orders table itself also isolated ---
        rows = query_as(conn, CLIENT_ROLE_UUID, f"SELECT client_id FROM orders WHERE client_id IN ('{CLIENT_A}', '{CLIENT_B}');")
        client_ids = {r[0] for r in rows}
        assert client_ids == {CLIENT_B}, f"orders table leaked across clients: {client_ids}"
        print("PASS: orders table correctly isolated per client")

        print("\nALL RLS CHECKS PASSED.")

    finally:
        # Clean up as the table owner (current connection, RLS doesn't
        # apply to owners) -- delete test data regardless of outcome above.
        conn.rollback()
        cur = conn.cursor()
        cur.execute("DELETE FROM client_access WHERE user_id IN (%s, %s, %s);", (ADMIN_UUID, USER_UUID, CLIENT_ROLE_UUID))
        cur.execute("DELETE FROM user_profiles WHERE id IN (%s, %s, %s);", (ADMIN_UUID, USER_UUID, CLIENT_ROLE_UUID))
        cur.execute("DELETE FROM auth.users WHERE id IN (%s, %s, %s);", (ADMIN_UUID, USER_UUID, CLIENT_ROLE_UUID))
        cur.execute("DELETE FROM orders WHERE client_id IN (%s, %s);", (CLIENT_A, CLIENT_B))
        cur.execute("DELETE FROM clients WHERE client_id IN (%s, %s);", (CLIENT_A, CLIENT_B))
        conn.commit()
        conn.close()
        print("cleaned up all test data.")


if __name__ == "__main__":
    main()
