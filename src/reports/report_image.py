"""Renders the Business Health Report table as a PNG (for WhatsApp).

Same content rules as the Excel report (business_health_report.py): the
client's own columns/labels/header colour/derived columns, a Total row
computed by compute_totals(), PROAS on a red -> yellow -> green scale over
the table's own values. Drawn with Pillow's bundled scalable font, so it
needs no system fonts (works the same on a laptop and in GitHub Actions).
"""

from datetime import date, datetime

from PIL import Image, ImageDraw, ImageFont

from src.reports.business_health_report import (
    SUM_KEYS, LAST_KEYS, _is_dark, _num, _derived_value, compute_totals,
)
from src.reports.report_columns import resolve_columns, resolve_derived_columns, resolve_header_color, resolve_ideal_roas

FONT_SIZE = 15
PAD_X, PAD_Y = 10, 7
TITLE_H = 44
LINE_COLOR = (170, 170, 170)


def _scale_color(t: float) -> tuple[int, int, int]:
    """0 -> red F8696B, 0.5 -> yellow FFEB84, 1 -> green 63BE7B (Excel's scale)."""
    red, yellow, green = (248, 105, 107), (255, 235, 132), (99, 190, 123)
    a, b, u = (red, yellow, t * 2) if t < 0.5 else (yellow, green, (t - 0.5) * 2)
    return tuple(round(a[i] + (b[i] - a[i]) * u) for i in range(3))


def _fmt(value, number_format: str) -> str:
    if value is None:
        return ""
    if number_format == "DD-MM-YYYY":
        d = value if isinstance(value, (date, datetime)) else datetime.fromisoformat(str(value))
        return d.strftime("%d-%m-%Y")
    v = float(value)
    if number_format == "0.0%":
        return f"{v * 100:.1f}%"
    if number_format == "0.0":
        return f"{v:.1f}"
    if number_format == "#,##0":
        return f"{v:,.0f}"
    return f"{v:,.2f}"


def _wrap(draw, text: str, font, max_w: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if cur and draw.textlength(trial, font=font) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    return lines + [cur] if cur else lines or [""]


def render_report_png(rows: list[dict], title: str, output_path: str, report_config: dict | None = None) -> None:
    """rows: daily_report_metrics rows, oldest first. Must be non-empty."""
    font = ImageFont.load_default(FONT_SIZE)
    title_font = ImageFont.load_default(FONT_SIZE + 4)
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))

    columns = [(label, key, fmt, None) for label, key, fmt in resolve_columns(report_config)]
    for d in resolve_derived_columns(report_config):
        if not (d.get("key") and d.get("label") and d.get("formula")):
            continue
        entry = (d["label"], d["key"], "0.0%" if d.get("isPct") else "#,##0.00", d["formula"])
        keys_now = [c[1] for c in columns]
        columns.insert(keys_now.index(d["after"]) + 1, entry) if d.get("after") in keys_now else columns.append(entry)
    keys = [c[1] for c in columns]

    # Cell text: data rows, then Total.
    body: list[list[str]] = []
    values_by_row: list[dict] = []
    for row in rows:
        variables = {k: _num(row.get(k)) for k in set(keys) | SUM_KEYS | LAST_KEYS | {"aov", "proas"} if k != "report_date"}
        cells = []
        for _, key, fmt, formula in columns:
            if formula is not None:
                value = _derived_value(formula, variables)
                variables[key] = value
            else:
                value = row.get(key)
            cells.append(_fmt(value, fmt))
        body.append(cells)
        values_by_row.append(variables)
    totals = compute_totals(rows)
    total_cells = []
    for _, key, fmt, formula in columns:
        if key == "report_date":
            total_cells.append("Total")
            continue
        if formula is not None:
            value = _derived_value(formula, totals)
            totals[key] = value
        else:
            value = totals.get(key)
        total_cells.append(_fmt(value, fmt))
    body.append(total_cells)
    values_by_row.append(totals)

    header_lines = [_wrap(probe, c[0], font, 110) for c in columns]
    header_h = max(len(h) for h in header_lines) * (FONT_SIZE + 4) + PAD_Y * 2
    col_w = []
    for i, lines in enumerate(header_lines):
        widest = max([probe.textlength(l, font=font) for l in lines] + [probe.textlength(r[i], font=font) for r in body])
        col_w.append(int(widest) + PAD_X * 2)
    row_h = FONT_SIZE + 4 + PAD_Y * 2

    width = sum(col_w) + 1
    height = TITLE_H + header_h + row_h * len(body) + 1
    img = Image.new("RGB", (max(width, 520), height), "white")
    d = ImageDraw.Draw(img)

    d.text((width / 2, TITLE_H / 2), title, fill="black", font=title_font, anchor="mm")

    header_color = resolve_header_color(report_config)
    fill = tuple(int(header_color[i:i + 2], 16) for i in (0, 2, 4))
    text_color = "white" if _is_dark(header_color) else "black"

    # PROAS gradient over data rows + Total: with the client's ideal ROAS it is
    # linear in value / ideal (0 red, half yellow, ideal+ green); without one it
    # is positioned by rank within the table (min red, median yellow, max green).
    proas_colors: dict[int, tuple] = {}
    if "proas" in keys:
        ideal = resolve_ideal_roas(report_config)
        vals = [(i, _num(v.get("proas"))) for i, v in enumerate(values_by_row)]
        present = sorted(v for _, v in vals if v is not None)
        if ideal:
            for i, v in vals:
                if v is not None:
                    proas_colors[i] = _scale_color(min(1.0, max(0.0, v / ideal)))
        elif present:
            lo, hi, mid = present[0], present[-1], present[len(present) // 2]
            for i, v in vals:
                if v is None:
                    continue
                if hi == lo:
                    t = 0.5
                elif v <= mid:
                    t = 0.5 * (v - lo) / (mid - lo) if mid > lo else 0.5
                else:
                    t = 0.5 + 0.5 * (v - mid) / (hi - mid) if hi > mid else 0.5
                proas_colors[i] = _scale_color(t)

    x = 0
    for i, lines in enumerate(header_lines):
        box = (x, TITLE_H, x + col_w[i], TITLE_H + header_h)
        d.rectangle(box, fill=fill, outline=LINE_COLOR)
        total_text_h = len(lines) * (FONT_SIZE + 4)
        y = TITLE_H + (header_h - total_text_h) / 2
        for line in lines:
            d.text((x + col_w[i] / 2, y), line, fill=text_color, font=font, anchor="mt", stroke_width=0)
            d.text((x + col_w[i] / 2 + 0.6, y), line, fill=text_color, font=font, anchor="mt")  # fake bold
            y += FONT_SIZE + 4
        x += col_w[i]

    for r, cells in enumerate(body):
        top = TITLE_H + header_h + r * row_h
        is_total = r == len(body) - 1
        x = 0
        for i, text in enumerate(cells):
            cell_fill = (242, 242, 242) if is_total else (255, 255, 255)
            if keys[i] == "proas" and r in proas_colors:
                cell_fill = proas_colors[r]
            d.rectangle((x, top, x + col_w[i], top + row_h), fill=cell_fill, outline=LINE_COLOR)
            cx, cy = x + col_w[i] / 2, top + row_h / 2
            d.text((cx, cy), text, fill="black", font=font, anchor="mm")
            if is_total:
                d.text((cx + 0.6, cy), text, fill="black", font=font, anchor="mm")
            x += col_w[i]

    img.save(output_path, "PNG")
