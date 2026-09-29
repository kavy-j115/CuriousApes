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

FONT_NAME = "Arial"
HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(name=FONT_NAME, bold=True, color="FFFFFF")
TITLE_FONT = Font(name=FONT_NAME, bold=True, size=14)
BODY_FONT = Font(name=FONT_NAME)

# (header label, db column, number format)
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
SUM_COLUMNS = {"sessions", "add_to_carts", "order_count", "gross_revenue",
                "amount_spent", "purchase_value", "mtd_sale", "lmtd_sale"}

# Not part of the target format's visible columns, but needed so the
# Checkout % total can be a real formula (SUM/SUM) instead of a Python-
# computed number typed in as a literal -- written as a hidden column.
HIDDEN_COLUMNS = [("Checkouts (raw)", "checkouts", "#,##0")]


def generate_report(rows: list[dict], display_name: str, output_path: str) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Business Health Report"

    n_cols = len(COLUMNS)
    last_col_letter = get_column_letter(n_cols)

    # Title
    ws.merge_cells(f"A1:{last_col_letter}1")
    title_cell = ws["A1"]
    title_cell.value = f"{display_name} - Business Health Report"
    title_cell.font = TITLE_FONT
    title_cell.alignment = Alignment(horizontal="center")

    all_columns = COLUMNS + HIDDEN_COLUMNS
    n_hidden = len(HIDDEN_COLUMNS)

    # Header
    header_row = 3
    for col_idx, (label, _, _) in enumerate(all_columns, start=1):
        cell = ws.cell(row=header_row, column=col_idx, value=label)
        if col_idx <= n_cols:
            cell.font = HEADER_FONT
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal="center", wrap_text=True)

    # Documented assumption, visible to the reader on the cell itself --
    # per the project's "no ambiguity around metrics" rule.
    conv_col_idx = next(i for i, (label, *_rest) in enumerate(COLUMNS, start=1) if label == "Conversion %")
    ws.cell(row=header_row, column=conv_col_idx).comment = Comment(
        "Defined as Shopify order_count / GA4 sessions. This crosses two data "
        "sources -- see docs/metrics.md if this isn't the intended definition.",
        "D2C Analytics Pipeline",
    )
    sessions_col_idx = next(i for i, (label, *_rest) in enumerate(COLUMNS, start=1) if label == "Sessions")
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
        elif db_col == "aov":
            gross_col = get_column_letter(_col_of(all_columns, "gross_revenue"))
            orders_col = get_column_letter(_col_of(all_columns, "order_count"))
            cell.value = f"=IFERROR({gross_col}{total_row}/{orders_col}{total_row},0)"
        elif db_col == "proas":
            pv_col = get_column_letter(_col_of(all_columns, "purchase_value"))
            spend_col = get_column_letter(_col_of(all_columns, "amount_spent"))
            cell.value = f"=IFERROR({pv_col}{total_row}/{spend_col}{total_row},0)"
        elif db_col == "atc_pct":
            atc_col = get_column_letter(_col_of(all_columns, "add_to_carts"))
            sess_col = get_column_letter(_col_of(all_columns, "sessions"))
            cell.value = f"=IFERROR({atc_col}{total_row}/{sess_col}{total_row},0)"
        elif db_col == "conversion_pct":
            orders_col = get_column_letter(_col_of(all_columns, "order_count"))
            sess_col = get_column_letter(_col_of(all_columns, "sessions"))
            cell.value = f"=IFERROR({orders_col}{total_row}/{sess_col}{total_row},0)"
        elif db_col == "checkout_pct":
            checkouts_col = get_column_letter(_col_of(all_columns, "checkouts"))
            sess_col = get_column_letter(_col_of(all_columns, "sessions"))
            cell.value = f"=IFERROR({checkouts_col}{total_row}/{sess_col}{total_row},0)"

    # PROAS conditional color scale (red -> yellow -> green), auto min/mid/max
    # since a hardcoded threshold wouldn't generalize across clients/date ranges.
    # Guarded on rows existing -- with zero data rows, first_data_row > total_row - 1,
    # producing a reversed/invalid range (e.g. "I4:I3") that openpyxl rejects.
    if rows:
        proas_col_letter = get_column_letter(_col_of(all_columns, "proas"))
        proas_range = f"{proas_col_letter}{first_data_row}:{proas_col_letter}{total_row - 1}"
        ws.conditional_formatting.add(
            proas_range,
            ColorScaleRule(
                start_type="min", start_color="F8696B",
                mid_type="percentile", mid_value=50, mid_color="FFEB84",
                end_type="max", end_color="63BE7B",
            ),
        )

    for col_idx in range(1, n_cols + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = 16

    hidden_col_letter = get_column_letter(n_cols + 1)
    ws.column_dimensions[hidden_col_letter].hidden = True

    wb.save(output_path)


def _col_of(columns: list, db_col: str) -> int:
    for i, (_, c, _) in enumerate(columns, start=1):
        if c == db_col:
            return i
    raise KeyError(db_col)
