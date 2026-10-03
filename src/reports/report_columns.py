"""Mirrors web/src/lib/reportColumns.ts's AVAILABLE_METRICS/DEFAULT_METRIC_KEYS
and resolveReportColumns() -- same metric catalogue, same default set, so
a client's Excel/DHR report and their web Reports page agree on what
their report looks like. Kept as a hand-maintained mirror rather than a
shared schema file since the two live in genuinely different languages/
runtimes; if the two ever drift, this file is the one to check first.
"""

# key -> (default label, Excel number format)
AVAILABLE_METRICS: dict[str, tuple[str, str]] = {
    "sessions": ("Sessions", "#,##0"),
    "add_to_carts": ("Sessions with cart additions", "#,##0"),
    "order_count": ("Orders", "#,##0"),
    "gross_revenue": ("Gross sales", "#,##0.00"),
    "net_revenue": ("Net Sales", "#,##0.00"),
    "total_sales": ("Total Sales", "#,##0.00"),
    "total_discounts": ("Discounts", "#,##0.00"),
    "total_refunded": ("Refunds", "#,##0.00"),
    "aov": ("Average order value", "#,##0.00"),
    "amount_spent": ("Amount Spent (Ad Spent)", "#,##0.00"),
    "purchase_value": ("Purchase Value (Ad Account)", "#,##0.00"),
    "proas": ("PROAS", "0.0"),
    "atc_pct": ("ATC %", "0.0%"),
    "conversion_pct": ("Conversion %", "0.0%"),
    "checkout_pct": ("Checkout %", "0.0%"),
    "mtd_sale": ("MTD Sale", "#,##0.00"),
    "lmtd_sale": ("LMTD", "#,##0.00"),
    # Same running totals but on Total sales, for clients whose report
    # headlines Total sales instead of Gross sales (e.g. "LMTD Total Sale").
    "mtd_total_sales": ("MTD Sale", "#,##0.00"),
    "lmtd_total_sales": ("LMTD Total Sale", "#,##0.00"),
}

# What every client gets unless report_config overrides it -- net_revenue
# left out (opt-in per client), matching the TS DEFAULT_METRIC_KEYS exactly.
DEFAULT_METRIC_KEYS = [
    "sessions", "add_to_carts", "order_count", "gross_revenue", "aov",
    "amount_spent", "purchase_value", "proas", "atc_pct", "conversion_pct",
    "checkout_pct", "mtd_sale", "lmtd_sale",
]

def resolve_columns(report_config: dict | None) -> list[tuple[str, str, str]]:
    """Returns (label, db_column, number_format) tuples, "Day" always
    first and never configurable. An unrecognized key in report_config
    (e.g. a stale/typo'd one) is silently skipped rather than crashing the
    report -- same "a report generates something sane, not nothing"
    principle as everywhere else blank/missing data is handled here."""
    day_column = ("Day", "report_date", "DD-MM-YYYY")

    columns = report_config.get("columns") if report_config else None
    if columns:
        metric_columns = [
            (c.get("label") or AVAILABLE_METRICS[c["key"]][0], c["key"], AVAILABLE_METRICS[c["key"]][1])
            for c in columns
            if c.get("key") in AVAILABLE_METRICS
        ]
    else:
        metric_columns = [(AVAILABLE_METRICS[k][0], k, AVAILABLE_METRICS[k][1]) for k in DEFAULT_METRIC_KEYS]

    return [day_column] + metric_columns


DEFAULT_HEADER_COLOR = "4472C4"


def resolve_derived_columns(report_config: dict | None) -> list[dict]:
    """The client's extra computed columns ({key, label, formula, isPct}),
    appended after the metric columns -- same as the web Reports page."""
    return list((report_config or {}).get("derivedColumns") or [])


def resolve_header_color(report_config: dict | None) -> str:
    """Per-client header fill (hex, no #) -- each brand's report has its own."""
    color = ((report_config or {}).get("headerColor") or "").lstrip("#")
    return color if len(color) == 6 and all(c in "0123456789abcdefABCDEF" for c in color) else DEFAULT_HEADER_COLOR
