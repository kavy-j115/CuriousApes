"""Loads config/whatsapp.yaml -- the agency's one shared WhatsApp Business
sender. Not a per-client file: there's exactly one WhatsApp Business phone
number for the whole agency, same shared-credential reasoning as
agency.meta_ads.access_token and agency.ga4.service_account_json (see
docs/secrets.md) -- a client only needs their alert recipients' phone
numbers added to their own config, nothing WhatsApp-specific.
"""

from pathlib import Path

import yaml

from src.config.vault import get_secret

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "whatsapp.yaml"


def load_whatsapp_config(conn) -> dict | None:
    """Returns {phone_number_id, access_token, template_name,
    template_language}, or None if config/whatsapp.yaml doesn't exist (not
    set up yet) or its Vault secret hasn't been created -- callers should
    skip sending in that case, same pattern as a client with no meta_ads/
    ga4 section, not crash the pipeline."""
    if not CONFIG_PATH.exists():
        return None
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)
    if not config or not config.get("phone_number_id"):
        return None
    access_token = get_secret(conn, config["access_token_secret"])
    if not access_token:
        return None
    return {
        "phone_number_id": config["phone_number_id"],
        "access_token": access_token,
        "template_name": config.get("template_name", "alert_notification"),
        "template_language": config.get("template_language", "en_US"),
    }
