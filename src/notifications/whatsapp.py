"""Sends WhatsApp messages via Twilio's WhatsApp API.

Switched from Meta's WhatsApp Business Cloud API: that needed a verified
WhatsApp Business phone number added to the agency's Meta Business
Manager, which wasn't available for testing yet. Twilio provides a free
Sandbox number (joinable instantly via a code, no business verification
needed) that works immediately for development -- the same `send_whatsapp_alert`
call just needs different credentials once a real Twilio WhatsApp sender
replaces the sandbox later.

Unlike Meta, Twilio's sandbox allows plain free-form text (no pre-approved
message template required) -- that restriction only applies to Twilio's
production WhatsApp Business API outside the sandbox, not here.
"""

import requests
from requests.auth import HTTPBasicAuth


def _as_whatsapp_address(raw: str) -> str:
    return raw if raw.startswith("whatsapp:") else f"whatsapp:{raw}"


def send_whatsapp_alert(account_sid: str, auth_token: str, from_number: str, to_phone: str, body_text: str) -> None:
    """to_phone: E.164 format (e.g. '+919876543210')."""
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    response = requests.post(
        url,
        auth=HTTPBasicAuth(account_sid, auth_token),
        data={
            "From": _as_whatsapp_address(from_number),
            "To": _as_whatsapp_address(to_phone),
            "Body": body_text,
        },
        timeout=15,
    )
    if not response.ok:
        raise requests.HTTPError(f"WhatsApp send failed ({response.status_code}): {response.text}")
