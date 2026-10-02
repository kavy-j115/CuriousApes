"""Email delivery for client reports, over plain SMTP.

Credentials live in Supabase Vault, never in config or git:
  agency.email.smtp_user      the sending mailbox (also the From address)
  agency.email.smtp_password  an app password for it (NOT the account password)
  agency.email.smtp_host      optional, defaults to smtp.gmail.com
Port 587 with STARTTLS.

Reads only our own database -- no Shopify/Meta/GA4 calls happen here.
"""

import html
import smtplib
from email.message import EmailMessage
from pathlib import Path

from src.config.vault import get_secret

DEFAULT_HOST = "smtp.gmail.com"
PORT = 587


def load_email_config(conn) -> dict | None:
    """None when the sending mailbox isn't set up yet, so callers can say so
    plainly instead of failing mid-send."""
    user = get_secret(conn, "agency.email.smtp_user")
    password = get_secret(conn, "agency.email.smtp_password")
    if not user or not password:
        return None
    return {"user": user, "password": password, "host": get_secret(conn, "agency.email.smtp_host") or DEFAULT_HOST}


def _format_cell(value, number_format: str) -> str:
    if value is None or value == "":
        return "-"
    if number_format == "DD-MM-YYYY":
        return value.strftime("%d-%m-%Y") if hasattr(value, "strftime") else str(value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if number_format.endswith("%"):
        return f"{number * 100:.1f}%"
    if number_format == "#,##0":
        return f"{number:,.0f}"
    if number_format == "0.0":
        return f"{number:.1f}"
    return f"{number:,.2f}"


def build_summary(rows: list[dict], columns: list[tuple[str, str, str]], display_name: str) -> tuple[str, str]:
    """(html, plain text) summary of the report rows, newest first -- readable
    in a phone mail app, where an attachment's formulas may not preview."""
    shown = sorted(rows, key=lambda r: r["report_date"], reverse=True)
    header = [label for label, _, _ in columns]
    body = [[_format_cell(r.get(col), fmt) for _, col, fmt in columns] for r in shown]

    th = "".join(
        f'<th style="text-align:left;padding:6px 10px;border-bottom:1px solid #ccc;white-space:nowrap">{html.escape(h)}</th>'
        for h in header
    )
    trs = "".join(
        "<tr>"
        + "".join(f'<td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">{html.escape(c)}</td>' for c in row)
        + "</tr>"
        for row in body
    )
    html_body = (
        '<div style="font-family:system-ui,sans-serif;font-size:14px">'
        f'<h2 style="margin:0 0 4px">{html.escape(display_name)} - Business Health Report</h2>'
        f'<p style="margin:0 0 12px;color:#666">Last {len(shown)} day(s). Full Excel report attached.</p>'
        f'<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px"><tr>{th}</tr>{trs}</table></div></div>'
    )
    text_body = f"{display_name} - Business Health Report (last {len(shown)} day(s))\n\n" + "\n".join(
        " | ".join(f"{h}: {c}" for h, c in zip(header, row)) for row in body
    )
    return html_body, text_body


def send_report_email(
    config: dict,
    to_addresses: list[str],
    subject: str,
    html_body: str,
    text_body: str,
    attachment: Path | None = None,
) -> None:
    message = EmailMessage()
    message["From"] = config["user"]
    message["To"] = ", ".join(to_addresses)
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    if attachment is not None:
        message.add_attachment(
            attachment.read_bytes(),
            maintype="application",
            subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=attachment.name,
        )
    with smtplib.SMTP(config["host"], PORT, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(config["user"], config["password"])
        smtp.send_message(message)
