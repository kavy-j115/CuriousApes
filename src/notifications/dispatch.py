"""Turns rows in `alerts` that haven't been sent yet into WhatsApp
messages, then marks them sent. Deliberately separate from
src/analytics/alerts.py's detection logic -- detecting an alert and
delivering it are different failure modes (a correct alert can still fail
to *send* if a phone number is wrong or the WhatsApp API is down), and
this split means a send failure can be retried on the next pipeline run
without re-running detection or losing the alert.
"""

from src.notifications.whatsapp import send_whatsapp_alert


def send_pending_alerts(conn, client_id: str, recipients: list[str], whatsapp_config: dict) -> tuple[int, list[tuple[str, str]]]:
    """Sends every not-yet-notified alert for this client to every
    configured recipient. An alert is marked notified_at only once EVERY
    recipient succeeded -- a bad number among several recipients doesn't
    cause the whole alert to be dropped (recipients who succeeded still got
    it), but also doesn't get silently marked fully delivered when it
    wasn't; it'll be retried (and land again for those who already got it,
    a deliberate "better a duplicate than a silent miss" trade-off) on the
    next run until every recipient succeeds.

    Returns (number of alerts newly sent, list of (alert_type, error) for
    every failed send) -- the caller surfaces failures the same way any
    other pipeline step failure is surfaced.
    """
    if not recipients:
        return 0, []

    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, alert_type, message FROM alerts
        WHERE client_id = %s AND notified_at IS NULL
        ORDER BY id;
        """,
        (client_id,),
    )
    pending = cur.fetchall()
    cur.close()

    sent_count = 0
    errors: list[tuple[str, str]] = []
    for alert_id, alert_type, message in pending:
        all_ok = True
        for phone in recipients:
            try:
                send_whatsapp_alert(whatsapp_config, phone, f"[{client_id}] {message}")
            except Exception as e:
                all_ok = False
                errors.append((alert_type, str(e)))
        if all_ok:
            sent_count += 1
            cur = conn.cursor()
            cur.execute("UPDATE alerts SET notified_at = now() WHERE id = %s;", (alert_id,))
            conn.commit()
            cur.close()

    return sent_count, errors
