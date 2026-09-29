"""AI Analyst: turns already-computed daily_report_metrics numbers into a
written interpretation.

Architecture, per the original project brief, enforced deliberately:
Python/SQL calculate every number; the AI only interprets numbers already
computed and validated elsewhere in this pipeline. It is never handed raw
order/session data and asked to compute anything itself.
"""

import os

import anthropic
import psycopg2.extras

MODEL = "claude-sonnet-5"

METRICS = [
    "order_count", "gross_revenue", "aov", "sessions", "add_to_carts",
    "amount_spent", "purchase_value", "proas", "atc_pct", "conversion_pct", "checkout_pct",
]

SYSTEM_PROMPT = """You are a D2C business analyst. You are given a client's
daily business metrics: today's numbers, and a trailing-average baseline
already computed from recent history. All numbers have already been
calculated correctly elsewhere -- do not recompute, re-derive, or
second-guess them.

Write a short daily report with three clearly labeled sections:

FACT -- things directly stated by the numbers given (e.g. "Orders rose from
3 to 5").

INTERPRETATION -- a reasonable read of what a fact might mean, clearly
flagged as interpretation, not certainty.

HYPOTHESIS -- something worth investigating that the data suggests but does
not confirm. Never present a hypothesis as an established fact.

If a metric is shown as unavailable, say so as a data-quality note -- never
guess a value or silently ignore the gap. If there is no historical
baseline at all, say so plainly rather than inventing a comparison.

Keep it concise: a few bullet points per section, not paragraphs."""


def get_metrics_for_analysis(conn, client_id: str, trailing_days: int = 7):
    """Returns (today_row, trailing_rows) -- today_row is the most recent
    date with data for this client (not necessarily today's calendar date,
    since a client's data may lag), trailing_rows are the days before it."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        "SELECT * FROM daily_report_metrics WHERE client_id = %s ORDER BY report_date DESC LIMIT 1;",
        (client_id,),
    )
    today_row = cur.fetchone()
    if not today_row:
        return None, []

    cur.execute(
        """
        SELECT * FROM daily_report_metrics
        WHERE client_id = %s AND report_date < %s
        ORDER BY report_date DESC LIMIT %s;
        """,
        (client_id, today_row["report_date"], trailing_days),
    )
    trailing_rows = cur.fetchall()
    return today_row, trailing_rows


def _metric_context(today_row: dict, trailing_rows: list[dict]) -> str:
    """Builds the deterministic numeric summary the AI will interpret --
    this function computes the comparison; the AI never sees raw rows."""
    lines = [f"Today ({today_row['report_date']}):"]
    for m in METRICS:
        value = today_row.get(m)
        lines.append(f"  {m}: {value if value is not None else 'unavailable'}")

    if trailing_rows:
        lines.append(f"\nTrailing {len(trailing_rows)}-day average (days before today, excluding today):")
        for m in METRICS:
            values = [float(r[m]) for r in trailing_rows if r.get(m) is not None]
            if values:
                lines.append(f"  {m}: {sum(values) / len(values):.2f}")
            else:
                lines.append(f"  {m}: no data available in this window")
    else:
        lines.append(
            "\nNo historical data available for comparison -- this is either "
            "the first day of data for this client, or insufficient history exists yet."
        )

    return "\n".join(lines)


def generate_daily_analysis(display_name: str, today_row: dict, trailing_rows: list[dict], api_key: str | None = None) -> str:
    client = anthropic.Anthropic(api_key=api_key or os.environ["ANTHROPIC_API_KEY"])
    context = _metric_context(today_row, trailing_rows)

    message = client.messages.create(
        model=MODEL,
        max_tokens=800,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Client: {display_name}\n\n{context}"}],
    )
    return message.content[0].text


def save_report(conn, client_id: str, report_date, content: str) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO ai_daily_reports (client_id, report_date, content, model)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (client_id, report_date) DO UPDATE SET
            content = EXCLUDED.content, model = EXCLUDED.model, generated_at = now();
        """,
        (client_id, report_date, content, MODEL),
    )
    conn.commit()
    cur.close()
