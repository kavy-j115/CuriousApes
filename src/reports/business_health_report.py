"""Generates the "Business Health Report" .xlsx, matching the target format
supplied by the user, from daily_report_metrics.

Sessions/Amount Spent/PROAS/ATC%/Conversion%/Checkout% will be blank for any
date where GA4/Meta have no data yet -- that's an honest reflection of
pipeline state (connectors exist, real credentials/delivery data don't yet),
not a bug. Blank, never a fake 0, so a SUM total isn't silently wrong.
"""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter

from src.reports.report_columns import DEFAULT_ROAS_THRESHOLDS

FONT_NAME = "Arial"
HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(name=FONT_NAME, bold=True, color="FFFFFF")
TITLE_FONT = Font(name=FONT_NAME, bold=True, size=14)
BODY_FONT = Font(name=FONT_NAME)

# (header label, db column, number format) -- the default column set, used
# when a client has no report_config override (src/reports/report_columns.py
# is the per-client-configurable version of this same list).
COLUMNS = [
    ("Day", "report_date", "DD-MM-YYYY"),
    ("Sessions", "sessions", "#,##0"),
    ("Sessions with cart additions", "add_to_carts", "#,##0"),
    ("Orders", "order_count", "#,##0"),
    ("Gross sales", "gross_revenue", "#,##0.00"),
    ("Average order value", "aov", "#,##0.00"),
    ("Amount Spent (Ad Spent)", "amount_spent", "#,##0.00"),
    ("Purchase Value (Ad Account)", "purchase_value", "#,##0.00"),
    ("PROAS", "proas", "0.0"),
    ("ATC %", "atc_pct", "0.0%"),
    ("Conversion %", "conversion_pct", "0.0%"),
    ("Checkout %", "checkout_pct", "0.0%"),
    ("MTD Sale", "mtd_sale", "#,##0.00"),
    ("LMTD", "lmtd_sale", "#,##0.00"),
]

# Columns whose Total row should be SUM(); everything else is left as a
# formula relative to the summed columns (AOV, PROAS, and the % columns
# are ratios -- summing them directly would be meaningless).
SUM_COLUMNS = {"sessions", "add_to_carts", "order_count", "gross_revenue", "net_revenue",
                "amount_spent", "purchase_value", "mtd_sale", "lmtd_sale",
                "total_sales", "total_discounts", "total_refunded"}

# Each ratio column's Total-row formula and the two columns it divides.
RATIO_FORMULAS = {
    "aov": ("total_sales", "order_count"),
    "proas": ("purchase_value", "amount_spent"),
    "atc_pct": ("add_to_carts", "sessions"),
    "conversion_pct": ("order_count", "sessions"),
    "checkout_pct": ("checkouts", "sessions"),
}

# Not part of the target format's visible columns, but needed so the
# Checkout % total can be a real formula (SUM/SUM) instead of a Python-
# computed number typed in as a literal -- written as a hidden column.
HIDDEN_COLUMNS = [("Checkouts (raw)", "checkouts", "#,##0")]


def generate_report(
    rows: list[dict],
    display_name: str,
    output_path: str,
    columns: list[tuple[str, str, str]] | None = None,
    roas_thresholds: dict | None = None,
) -> None:
    """columns: (label, db_column, number_format) tuples, "Day" first --
    defaults to the fixed COLUMNS above. Pass src.reports.report_columns
    .resolve_columns(report_config) to respect a client's own column
    choice/labels instead. A ratio formula (AOV, PROAS, ATC%, etc.) whose
    dependency column isn't in the chosen set is simply left blank in the
    Total row rather than crashing -- a client who drops "Orders" from
    their report shouldn't break AOV's total, it just can't be computed."""
    columns = columns or COLUMNS
    roas_thresholds = roas_thresholds or DEFAULT_ROAS_THRESHOLDS

    wb = Workbook()
    ws = wb.active
    ws.title = "Business Health Report"

    n_cols = len(columns)
    last_col_letter = get_column_letter(n_cols)

    # Title
    ws.merge_cells(f"A1:{last_col_letter}1")
    title_cell = ws["A1"]
    title_cell.value = f"{display_name} - Business Health Report"
    title_cell.font = TITLE_FONT
    title_cell.alignment = Alignment(horizontal="center")

    needs_checkouts_helper = any(db_col == "checkout_pct" for _, db_col, _ in columns)
    all_columns = columns + (HIDDEN_COLUMNS if needs_checkouts_helper else [])
    n_hidden = len(HIDDEN_COLUMNS) if needs_checkouts_helper else 0

    # Header
    header_row = 3
    for col_idx, (label, _, _) in enumerate(all_columns, start=1):
        cell = ws.cell(row=header_row, column=col_idx, value=label)
        if col_idx <= n_cols:
            cell.font = HEADER_FONT
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal="center", wrap_text=True)

    # Documented assumptions, visible to the reader on the cell itself --
    # only attached if that column is actually present in this client's set.
    conv_col_idx = _col_of_or_none(columns, "conversion_pct")
    if conv_col_idx:
        ws.cell(row=header_row, column=conv_col_idx).comment = Comment(
            "Defined as Shopify order_count / GA4 sessions. This crosses two data "
            "sources -- see docs/metrics.md if this isn't the intended definition.",
            "D2C Analytics Pipeline",
        )
    sessions_col_idx = _col_of_or_none(columns, "sessions")
    if sessions_col_idx:
        ws.cell(row=header_row, column=sessions_col_idx).comment = Comment(
            "Blank rows mean GA4 has no data for that date yet (connector exists, "
            "real property credentials pending) -- not zero traffic.",
            "D2C Analytics Pipeline",
        )

    # Data rows
    first_data_row = header_row + 1
    for row_offset, row in enumerate(rows):
        r = first_data_row + row_offset
        for col_idx, (_, db_col, number_format) in enumerate(all_columns, start=1):
            cell = ws.cell(row=r, column=col_idx, value=row.get(db_col))
            cell.font = BODY_FONT
            cell.number_format = number_format

    # Total row
    total_row = first_data_row + len(rows)
    ws.cell(row=total_row, column=1, value="Total").font = Font(name=FONT_NAME, bold=True)

    for col_idx, (_, db_col, number_format) in enumerate(all_columns, start=1):
        if db_col == "report_date":
            continue
        col_letter = get_column_letter(col_idx)
        data_range = f"{col_letter}{first_data_row}:{col_letter}{total_row - 1}"
        cell = ws.cell(row=total_row, column=col_idx)
        cell.font = Font(name=FONT_NAME, bold=True)
        cell.number_format = number_format

        if db_col in SUM_COLUMNS or db_col == "checkouts":
            cell.value = f"=SUM({data_range})"
        elif db_col in RATIO_FORMULAS:
            numerator_col, denominator_col = RATIO_FORMULAS[db_col]
            num_letter = _col_letter_of_or_none(all_columns, numerator_col)
            den_letter = _col_letter_of_or_none(all_columns, denominator_col)
            if num_letter and den_letter:
                cell.value = f"=IFERROR({num_letter}{total_row}/{den_letter}{total_row},0)"
            # else: dependency column not in this client's set -- leave blank
            # rather than guess or crash.

    # PROAS conditional color scale, anchored to this client's configured
    # thresholds (green at/above `good`, red at/below `danger`) instead of
    # an auto data-driven min/max -- keeps the Excel/DHR coloring consistent
    # with what the same client sees on the web Reports page, rather than
    # two independently-scaled gradients for the same number.
    proas_col_idx = _col_of_or_none(columns, "proas")
    if rows and proas_col_idx:
        proas_col_letter = get_column_letter(proas_col_idx)
        proas_range = f"{proas_col_letter}{first_data_row}:{proas_col_letter}{total_row - 1}"
        ws.conditional_formatting.add(
            proas_range,
            ColorScaleRule(
                start_type="num", start_value=roas_thresholds["danger"], start_color="F8696B",
                mid_type="num", mid_value=(roas_thresholds["danger"] + roas_thresholds["good"]) / 2, mid_color="FFEB84",
                end_type="num", end_value=roas_thresholds["good"], end_color="63BE7B",
            ),
        )

    for col_idx in range(1, n_cols + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = 16

    if n_hidden:
        hidden_col_letter = get_column_letter(n_cols + 1)
        ws.column_dimensions[hidden_col_letter].hidden = True

    wb.save(output_path)


def _col_of_or_none(columns: list, db_col: str) -> int | None:
    for i, (_, c, _) in enumerate(columns, start=1):
        if c == db_col:
            return i
    return None


def _col_letter_of_or_none(columns: list, db_col: str) -> str | None:
    idx = _col_of_or_none(columns, db_col)
    return get_column_letter(idx) if idx else None
