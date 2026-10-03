"""Loads config/whatsapp.yaml -- the agency's one shared WhatsApp sender
(Meta WhatsApp Cloud API, the company's own verified number). Not a
per-client file: one sender for the whole agency, same shared-credential
reasoning as agency.meta_ads.access_token (see docs/secrets.md) -- a client
only needs their recipients' phone numbers.
"""

from pathlib import Path

import yaml

from src.config.vault import get_secret

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "whatsapp.yaml"


def load_whatsapp_config(conn) -> dict | None:
    """Returns {phone_number_id, access_token, alert_template,
    report_template, template_language}, or None if the file doesn't exist,
    phone_number_id is blank (not set up yet) or the Vault token is missing
    -- callers skip sending in that case."""
    if not CONFIG_PATH.exists():
        return None
    with open(CONFIG_PATH, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    if not config or not config.get("phone_number_id"):
        return None
    access_token = get_secret(conn, config["access_token_secret"])
    if not access_token:
        return None
    return {
        "phone_number_id": str(config["phone_number_id"]),
        "access_token": access_token,
        "alert_template": config.get("alert_template", "alert_notification"),
        "report_template": config.get("report_template", "daily_report_image"),
        "template_language": config.get("template_language", "en"),
        "display_number": config.get("display_number", ""),
    }
