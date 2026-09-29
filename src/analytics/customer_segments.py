"""Customer segment queries -- who qualifies for a campaign, based on their
order history. Each function returns a list of customer dicts (email,
phone, first_name, last_name) ready to hand to an export function like
src/reports/convertway_export.py.
"""

from datetime import date, timedelta


def get_customers_by_last_order_window(conn, client_id: str, min_days_ago: int, max_days_ago: int) -> list[dict]:
    """Customers whose most recent order fell between min_days_ago and
    max_days_ago days before today -- e.g. a "hasn't ordered in 60-90 days"
    win-back window. min_days_ago must be smaller than max_days_ago (it's
    the closer-to-today edge of the window)."""
    if min_days_ago >= max_days_ago:
        raise ValueError("min_days_ago must be less than max_days_ago")

    today = date.today()
    window_end = today - timedelta(days=min_days_ago)    # closer to today
    window_start = today - timedelta(days=max_days_ago)  # further in the past

    cur = conn.cursor()
    cur.execute(
        """
        SELECT c.email, c.phone, c.first_name, c.last_name, MAX(o.created_at) AS last_order_at
        FROM customers c
        JOIN orders o ON o.client_id = c.client_id AND o.customer_id = c.shopify_customer_id
        WHERE c.client_id = %s
        GROUP BY c.email, c.phone, c.first_name, c.last_name
        HAVING MAX(o.created_at)::date BETWEEN %s AND %s;
        """,
        (client_id, window_start, window_end),
    )
    columns = ["email", "phone", "first_name", "last_name", "last_order_at"]
    return [dict(zip(columns, row)) for row in cur.fetchall()]
