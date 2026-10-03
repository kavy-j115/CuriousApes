"""Generates the "Business Health Report" .xlsx -- the per-client daily report
the agency sends -- from daily_report_metrics.

Follows the agency's own sample reports:
- one row per day, accumulating through the month, then a Total row;
- Total row: SUM for counts and amounts, a weighted ratio for PROAS / ATC % /
  Conversion % / Checkout %, an ORDER-weighted average for AOV, and the LAST
  day's running figure for MTD / LMTD (those are cumulative, not additive);
- Checkout % is orders / sessions with cart additions;
- PROAS is coloured on a continuous red -> yellow -> green scale based on the
  values in the table itself (never fixed good/bad thresholds);
- header colour, column choice, labels and extra computed columns (e.g. Zari's
  "Organic Sales") are per client, from that client's report_config.

Blank means "no data connected / not available" -- never a fake 0, so a SUM
total isn't silently wrong.
"""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter

from src.reports.formula_eval import evaluate_formula, FormulaError
from src.reports.report_columns import resolve_columns, resolve_derived_columns, resolve_header_color, resolve_ideal_roas

FONT_NAME = "Arial"
TITLE_FONT = Font(name=FONT_NAME, bold=True, size=14)
BODY_FONT = Font(name=FONT_NAME)
BOLD_FONT = Font(name=FONT_NAME, bold=True)
THIN = Side(style="thin", color="000000")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# Total row: which metrics sum, which are cumulative (take the last day), and
# which are ratios of two summed columns. AOV is handled separately
# (order-weighted average of the daily values).
SUM_KEYS = {
    "sessions", "add_to_carts", "order_count", "gross_revenue", "net_revenue",
    "amount_spent", "purchase_value", "total_sales", "total_discounts", "total_refunded",
}
LAST_KEYS = {"mtd_sale", "lmtd_sale", "mtd_total_sales", "lmtd_total_sales"}
RATIO_FORMULAS = {
    "proas": ("purchase_value", "amount_spent"),
    "atc_pct": ("add_to_carts", "sessions"),
    "conversion_pct": ("order_count", "sessions"),
    "checkout_pct": ("order_count", "add_to_carts"),
}


def _is_dark(hex_color: str) -> bool:
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return (0.299 * r + 0.587 * g + 0.114 * b) < 150


def _num(v):
    return None if v is None else float(v)


def compute_totals(rows: list[dict]) -> dict:
    """The Total row's values in Python (the Excel cells are live formulas;
    this mirrors them so derived columns can be totalled from the totals)."""
    def total(key):
        vals = [_num(r.get(key)) for r in rows if r.get(key) is not None]
        return sum(vals) if vals else None

    out = {key: total(key) for key in SUM_KEYS}
    for key in LAST_KEYS:
        out[key] = _num(rows[-1].get(key)) if rows else None
    weighted = [(_num(r.get("aov")), _num(r.get("order_count"))) for r in rows if r.get("aov") is not None and r.get("order_count")]
    orders = sum(o for _, o in weighted)
    out["aov"] = sum(a * o for a, o in weighted) / orders if orders else None
    for key, (num, den) in RATIO_FORMULAS.items():
        out[key] = out[num] / out[den] if out.get(num) is not None and out.get(den) else None
    return out


def _derived_value(formula: str, variables: dict):
    try:
        return evaluate_formula(formula, variables)
    except FormulaError:
        return None  # a bad formula leaves the cell blank, never crashes the report


def generate_report(rows: list[dict], display_name: str, output_path: str, report_config: dict | None = None) -> None:
    """rows: daily_report_metrics rows for the period, oldest first."""
    metric_columns = resolve_columns(report_config)
    derived = [d for d in resolve_derived_columns(report_config) if d.get("key") and d.get("label") and d.get("formula")]
    header_color = resolve_header_color(report_config)
    header_fill = PatternFill("solid", fgColor=header_color)
    header_font = Font(name=FONT_NAME, bold=True, color="FFFFFF" if _is_dark(header_color) else "000000")

    # (label, key, number format, derived formula or None). A derived column
    # with an "after" key is placed right after that column (Zari's "Organic
    # Sales" sits next to Total sales); otherwise it goes at the end.
    columns = [(label, key, fmt, None) for label, key, fmt in metric_columns]
    for d in derived:
        entry = (d["label"], d["key"], "0.0%" if d.get("isPct") else "#,##0.00", d["formula"])
        keys_now = [c[1] for c in columns]
        if d.get("after") in keys_now:
            columns.insert(keys_now.index(d["after"]) + 1, entry)
        else:
            columns.append(entry)
    n_cols = len(columns)
    keys = [c[1] for c in columns]

    def col_letter(key):
        return get_column_letter(keys.index(key) + 1) if key in keys else None

    wb = Workbook()
    ws = wb.active
    ws.title = "Business Health Report"

    ws.merge_cells(f"A1:{get_column_letter(n_cols)}1")
    ws["A1"].value = f"{display_name} - Business Health Report"
    ws["A1"].font = TITLE_FONT
    ws["A1"].alignment = Alignment(horizontal="center")

    header_row = 3
    for col_idx, (label, _, _, _) in enumerate(columns, start=1):
        cell = ws.cell(row=header_row, column=col_idx, value=label)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER

    if "sessions" in keys:
        ws.cell(row=header_row, column=keys.index("sessions") + 1).comment = Comment(
            "Blank means no traffic data for that date yet (not zero traffic).", "D2C Analytics Pipeline"
        )
    if "checkout_pct" in keys:
        ws.cell(row=header_row, column=keys.index("checkout_pct") + 1).comment = Comment(
            "Orders divided by sessions with cart additions.", "D2C Analytics Pipeline"
        )

    first_data_row = header_row + 1
    for offset, row in enumerate(rows):
        r = first_data_row + offset
        variables = {k: _num(row.get(k)) for k in set(keys) | SUM_KEYS | LAST_KEYS | {"aov", "proas"} if k != "report_date"}
        for col_idx, (_, key, fmt, formula) in enumerate(columns, start=1):
            if formula is not None:
                value = _derived_value(formula, variables)
                variables[key] = value  # later derived columns may build on this one
            else:
                value = row.get(key)
            cell = ws.cell(row=r, column=col_idx, value=value)
            cell.font = BODY_FONT
            cell.number_format = fmt
            cell.border = BORDER
            cell.alignment = Alignment(horizontal="center")

    total_row = first_data_row + len(rows)
    last_data_row = total_row - 1
    totals = compute_totals(rows)
    total_vars = {k: v for k, v in totals.items()}
    orders_letter = col_letter("order_count")

    for col_idx, (_, key, fmt, formula) in enumerate(columns, start=1):
        cell = ws.cell(row=total_row, column=col_idx)
        cell.font = BOLD_FONT
        cell.number_format = fmt
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center")
        letter = get_column_letter(col_idx)
        data_range = f"{letter}{first_data_row}:{letter}{last_data_row}"

        if key == "report_date":
            cell.value = "Total"
        elif formula is not None:
            # Derived columns are recomputed from the totals, not summed per day.
            value = _derived_value(formula, total_vars)
            total_vars[key] = value
            cell.value = value
        elif not rows:
            continue
        elif key in SUM_KEYS:
            cell.value = f"=SUM({data_range})"
        elif key in LAST_KEYS:
            cell.value = f"={letter}{last_data_row}"
        elif key == "aov":
            if orders_letter:
                orders_range = f"{orders_letter}{first_data_row}:{orders_letter}{last_data_row}"
                cell.value = f"=IFERROR(SUMPRODUCT({data_range},{orders_range})/{orders_letter}{total_row},0)"
        elif key in RATIO_FORMULAS:
            num_letter = col_letter(RATIO_FORMULAS[key][0])
            den_letter = col_letter(RATIO_FORMULAS[key][1])
            if num_letter and den_letter:
                cell.value = f"=IFERROR({num_letter}{total_row}/{den_letter}{total_row},0)"
            # else: a column this ratio needs isn't in this client's report --
            # left blank rather than guessed.

    # PROAS: a red -> yellow -> green gradient. With the client's ideal ROAS it
    # is anchored at 0 (red), half of ideal (yellow) and ideal (green) -- linear,
    # no other thresholds. Without one it spans the table's own values.
    if rows and "proas" in keys:
        pl = col_letter("proas")
        ideal = resolve_ideal_roas(report_config)
        if ideal:
            rule = ColorScaleRule(
                start_type="num", start_value=0, start_color="F8696B",
                mid_type="num", mid_value=ideal / 2, mid_color="FFEB84",
                end_type="num", end_value=ideal, end_color="63BE7B",
            )
        else:
            rule = ColorScaleRule(
                start_type="min", start_color="F8696B",
                mid_type="percentile", mid_value=50, mid_color="FFEB84",
                end_type="max", end_color="63BE7B",
            )
        ws.conditional_formatting.add(f"{pl}{first_data_row}:{pl}{total_row}", rule)

    for col_idx in range(1, n_cols + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = 16

    wb.save(output_path)
