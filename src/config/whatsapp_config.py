"""Loads config/whatsapp.yaml -- the agency's one shared WhatsApp (Twilio)
sender. Not a per-client file: there's exactly one WhatsApp sender for the
whole agency, same shared-credential reasoning as agency.meta_ads.access_token
and agency.ga4.service_account_json (see docs/secrets.md) -- a client only
needs their alert recipients' phone numbers added to their own config,
nothing WhatsApp-specific.
"""

from pathlib import Path

import yaml

from src.config.vault import get_secret

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "whatsapp.yaml"


def load_whatsapp_config(conn) -> dict | None:
    """Returns {account_sid, auth_token, from_number}, or None if
    config/whatsapp.yaml doesn't exist (not set up yet) or either Vault
    secret hasn't been created -- callers should skip sending in that
    case, same pattern as a client with no meta_ads/ga4 section."""
    if not CONFIG_PATH.exists():
        return None
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)
    if not config or not config.get("from_number"):
        return None
    account_sid = get_secret(conn, config["account_sid_secret"])
    auth_token = get_secret(conn, config["auth_token_secret"])
    if not account_sid or not auth_token:
        return None
    return {
        "account_sid": account_sid,
        "auth_token": auth_token,
        "from_number": config["from_number"],
    }
