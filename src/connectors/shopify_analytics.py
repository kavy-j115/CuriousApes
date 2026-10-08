"""Shopify's own daily analytics via ShopifyQL (the Admin GraphQL
`shopifyqlQuery` field) -- the same numbers the store's Analytics page shows,
so reports match Shopify by construction instead of re-deriving its tax,
cancellation and return rules from raw orders.

Needs the app to hold the `read_reports` scope (and protected customer data
access), and GraphQL Admin API 2025-10 or newer. If a store hasn't approved
that yet the call fails with a plain ShopifyAnalyticsError; nothing is guessed.

Column names below follow Shopify's documented `sales` and `sessions`
datasets. If Shopify returns different names, the error lists exactly which
columns came back, so a mismatch is a one-line fix and never a silent wrong
number.
"""

from src.connectors.shopify import _post, ShopifyGraphQLError

SHOPIFYQL_API_VERSION = "2025-10"

SHOPIFYQL_QUERY = """
query RunShopifyQL($q: String!) {
  shopifyqlQuery(query: $q) {
    parseErrors
    tableData {
      columns { name dataType displayName }
      rows
    }
  }
}
"""

SALES_COLUMNS = ["orders", "gross_sales", "discounts", "returns", "net_sales", "shipping_charges", "taxes", "total_sales"]
SESSION_COLUMNS = ["sessions", "sessions_with_cart_additions", "sessions_that_reached_checkout"]


class ShopifyAnalyticsError(Exception):
    pass


def _run(store_domain: str, access_token: str, shopifyql: str) -> list[dict]:
    """Runs one ShopifyQL query and returns its rows as dicts keyed by column name."""
    try:
        data = _post(store_domain, access_token, SHOPIFYQL_QUERY, {"q": shopifyql}, SHOPIFYQL_API_VERSION)
    except ShopifyGraphQLError as e:
        raise ShopifyAnalyticsError(
            f"Shopify rejected the analytics query ({e}). The app probably needs the read_reports scope "
            f"re-approved on this store."
        ) from e

    result = data.get("shopifyqlQuery") or {}
    if result.get("parseErrors"):
        raise ShopifyAnalyticsError(f"ShopifyQL didn't accept the query: {result['parseErrors']}")
    table = result.get("tableData")
    if not table:
        raise ShopifyAnalyticsError("Shopify returned no analytics table.")

    names = [c["name"] for c in table["columns"]]
    rows = []
    for row in table["rows"]:
        # Rows arrive as objects keyed by column name; accept positional lists too.
        rows.append(dict(zip(names, row)) if isinstance(row, (list, tuple)) else dict(row))
    return rows


def _number(value) -> float:
    if value is None or value == "":
        return 0.0
    return float(value)


def _require(rows: list[dict], expected: list[str], dataset: str) -> None:
    if not rows:
        return
    present = set(rows[0].keys())
    missing = [c for c in expected + ["day"] if c not in present]
    if missing:
        raise ShopifyAnalyticsError(
            f"The Shopify {dataset} analytics came back without column(s) {missing}. "
            f"Columns returned: {sorted(present)}."
        )


def fetch_daily_sales(store_domain: str, access_token: str, since: str, until: str) -> list[dict]:
    """One dict per day: report_date (YYYY-MM-DD) plus the sales columns as
    positive numbers (Shopify shows discounts/returns as negatives)."""
    q = f"FROM sales SHOW {', '.join(SALES_COLUMNS)} TIMESERIES day SINCE {since} UNTIL {until} ORDER BY day"
    rows = _run(store_domain, access_token, q)
    _require(rows, SALES_COLUMNS, "sales")
    out = []
    for r in rows:
        out.append({
            "report_date": str(r["day"])[:10],
            "orders": int(round(_number(r["orders"]))),
            "gross_sales": _number(r["gross_sales"]),
            "discounts": abs(_number(r["discounts"])),
            "returns": abs(_number(r["returns"])),
            "net_sales": _number(r["net_sales"]),
            "shipping_charges": _number(r["shipping_charges"]),
            "taxes": _number(r["taxes"]),
            "total_sales": _number(r["total_sales"]),
        })
    return out


def fetch_daily_sessions(store_domain: str, access_token: str, since: str, until: str) -> list[dict]:
    q = f"FROM sessions SHOW {', '.join(SESSION_COLUMNS)} TIMESERIES day SINCE {since} UNTIL {until} ORDER BY day"
    rows = _run(store_domain, access_token, q)
    _require(rows, SESSION_COLUMNS, "sessions")
    return [
        {
            "report_date": str(r["day"])[:10],
            "sessions": int(round(_number(r["sessions"]))),
            "added_to_cart": int(round(_number(r["sessions_with_cart_additions"]))),
            "reached_checkout": int(round(_number(r["sessions_that_reached_checkout"]))),
        }
        for r in rows
    ]


def _month_windows(since: str, until: str) -> list[tuple[str, str, str]]:
    """(month 'YYYY-MM-01', first day, last day) for every calendar month from since to until."""
    from datetime import date, timedelta
    first, last = date.fromisoformat(since), date.fromisoformat(until)
    out = []
    m = first.replace(day=1)
    while m <= last:
        nxt = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        out.append((m.isoformat(), max(m, first).isoformat(), min(nxt - timedelta(days=1), last).isoformat()))
        m = nxt
    return out


def fetch_landing_page_sessions(store_domain: str, access_token: str, since: str, until: str, limit: int = 300) -> list[dict]:
    """Sessions and add-to-cart sessions per landing page, one query per calendar month
    (the top `limit` pages of each month). One query per month, not one timeseries query,
    so every month is complete on its own: a single combined query returned all pages under
    the first month. Each dict: month (YYYY-MM-01), landing_page_path, sessions,
    sessions_with_cart_additions. A rejected query raises ShopifyAnalyticsError."""
    out: list[dict] = []
    for month, start, end in _month_windows(since, until):
        q = (
            "FROM sessions SHOW sessions, sessions_with_cart_additions "
            f"GROUP BY landing_page_path SINCE {start} UNTIL {end} "
            f"ORDER BY sessions DESC LIMIT {int(limit)}"
        )
        rows = _run(store_domain, access_token, q)
        if rows:
            present = set(rows[0].keys())
            missing = [c for c in ("landing_page_path", "sessions", "sessions_with_cart_additions") if c not in present]
            if missing:
                raise ShopifyAnalyticsError(
                    f"The landing page report came back without column(s) {missing}. Columns returned: {sorted(present)}."
                )
        out.extend(
            {
                "month": month,
                "landing_page_path": str(r["landing_page_path"] or "(unknown)"),
                "sessions": int(round(_number(r["sessions"]))),
                "sessions_with_cart_additions": int(round(_number(r["sessions_with_cart_additions"]))),
            }
            for r in rows
        )
    return out
