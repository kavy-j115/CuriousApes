"""Sends WhatsApp messages via Meta's WhatsApp Business Cloud API (Graph API).

Business-initiated messages (alerts, scheduled reports) must use a
pre-approved *template* -- free-form text is only allowed inside the 24h
window after the recipient last messaged the number. So both senders here
fill template variables rather than posting raw text.

Templates (created and approved in WhatsApp Manager, see docs/notifications.md):
  alert template  -- body has exactly ONE variable: {{1}} = alert text
  report template -- IMAGE header + body with ONE variable: {{1}} = caption
The report is a PNG picture of the table. Replies to clients who message the
bot (web/src/app/api/whatsapp/webhook) need no template -- inside the 24h
window after their message, free-form images are allowed.
"""

import re

import requests

GRAPH_API_VERSION = "v21.0"


def _clean_phone(raw: str) -> str:
    """Cloud API wants digits only with country code (no '+', spaces, dashes)."""
    return re.sub(r"\D", "", raw)


def _clean_param(text: str) -> str:
    # Template variables can't contain newlines/tabs or 4+ consecutive spaces.
    return re.sub(r"\s{2,}", " ", text.replace("\n", " ").replace("\t", " ")).strip()


def _send_template(
    phone_number_id: str, access_token: str, to_phone: str, template_name: str, language: str,
    params: list[str], header_image_url: str | None = None,
) -> None:
    components = []
    if header_image_url:
        components.append({"type": "header", "parameters": [{"type": "image", "image": {"link": header_image_url}}]})
    components.append({"type": "body", "parameters": [{"type": "text", "text": _clean_param(p)} for p in params]})
    response = requests.post(
        f"https://graph.facebook.com/{GRAPH_API_VERSION}/{phone_number_id}/messages",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "messaging_product": "whatsapp",
            "to": _clean_phone(to_phone),
            "type": "template",
            "template": {"name": template_name, "language": {"code": language}, "components": components},
        },
        timeout=15,
    )
    if not response.ok:
        raise requests.HTTPError(f"WhatsApp send failed ({response.status_code}): {response.text}")


def send_whatsapp_alert(whatsapp_config: dict, to_phone: str, body_text: str) -> None:
    """to_phone: E.164 format (e.g. '+919876543210')."""
    _send_template(
        whatsapp_config["phone_number_id"],
        whatsapp_config["access_token"],
        to_phone,
        whatsapp_config["alert_template"],
        whatsapp_config["template_language"],
        [body_text],
    )


def send_whatsapp_report_image(whatsapp_config: dict, to_phone: str, caption: str, image_url: str) -> None:
    """Scheduled daily report: an approved template with an IMAGE header.
    image_url: a time-limited signed Supabase Storage URL (the bucket stays
    private); Meta fetches it when the message is sent."""
    _send_template(
        whatsapp_config["phone_number_id"],
        whatsapp_config["access_token"],
        to_phone,
        whatsapp_config["report_template"],
        whatsapp_config["template_language"],
        [caption],
        header_image_url=image_url,
    )
