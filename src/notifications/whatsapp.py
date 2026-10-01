"""Sends WhatsApp messages via Meta's WhatsApp Business Cloud API -- the
same Business Manager the Meta Ads connector already authenticates
against, not a separate third-party provider (see docs/notifications.md).

WhatsApp only allows a free-form message within a 24-hour window after the
recipient last messaged the business number. Nobody is going to message a
bot every morning just so an unattended alert job is allowed to text them
back, so this always sends a pre-approved message TEMPLATE, never free
text -- templates are the one message type WhatsApp allows outside that
window.
"""

import requests

GRAPH_API_VERSION = "v21.0"


def send_whatsapp_alert(
    phone_number_id: str,
    access_token: str,
    to_phone: str,
    template_name: str,
    template_language: str,
    body_text: str,
) -> None:
    """to_phone: E.164 format (e.g. '+919876543210'). body_text fills the
    template's single {{1}} body placeholder -- see docs/notifications.md
    for the exact template text this expects to have been approved as."""
    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone.lstrip("+"),
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": template_language},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": body_text}]}
            ],
        },
    }
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        json=payload,
        timeout=15,
    )
    if not response.ok:
        raise requests.HTTPError(f"WhatsApp send failed ({response.status_code}): {response.text}")
