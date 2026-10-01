"""Loads config/clients/*.yaml -- one file per brand this agency manages.

Two different kinds of values live in these files, deliberately handled
differently:
- **Identifiers** (store domain, ad account ID) aren't secret -- useless
  without the credential alongside them -- so they're plain values, safe to
  commit and safe to read directly out of the parsed YAML.
- **Credentials** (access tokens, service account keys) are never stored
  here directly. A field like `access_token_secret` names a secret stored
  in Supabase Vault (see src/config/vault.py); resolve_secret() looks it up.

This split is what keeps GitHub Actions Secrets down to just DATABASE_URL
regardless of how many clients exist -- adding a new client is "add a
yaml file + a few vault.create_secret() calls," no GitHub-side setup, no
code changes. See docs/secrets.md.

resolve_env() still exists for genuinely local/bootstrap values that
aren't per-client credentials at all.
"""

import os
from pathlib import Path

import yaml

from src.config.vault import get_secret

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config" / "clients"


def load_all(conn=None) -> list[dict]:
    """Returns one dict per client config file, each with a resolved
    'client_id' at minimum. Skips a file if its client_id is missing.

    thresholds/notifications.whatsapp_recipients are overlaid from the
    `clients` table (sql/018_client_notifications.sql) when `conn` is
    given, OVERWRITING whatever a YAML file might still have under those
    same keys -- these moved to being admin-UI-managed (an operational
    setting, not a credential or identifier) rather than git-tracked
    config, so the database is now the source of truth for them. Every
    existing caller of get_value(config, "thresholds") / get_value(config,
    "notifications", "whatsapp_recipients") keeps working unchanged, since
    this merges into the exact same dict shape they already expect."""
    clients = []
    for path in sorted(CONFIG_DIR.glob("*.yaml")):
        with open(path) as f:
            config = yaml.safe_load(f)
        if config and config.get("client_id"):
            clients.append(config)

    if conn is not None:
        cur = conn.cursor()
        for config in clients:
            cur.execute(
                "SELECT alert_thresholds, whatsapp_recipients FROM clients WHERE client_id = %s;",
                (config["client_id"],),
            )
            row = cur.fetchone()
            if row:
                alert_thresholds, whatsapp_recipients = row
                config["thresholds"] = alert_thresholds or {}
                config["notifications"] = {"whatsapp_recipients": list(whatsapp_recipients or [])}
        cur.close()

    return clients


def get_value(config: dict, *keys: str):
    """Walks a dotted path of keys into config, returning whatever plain
    value is there (or None if any step is missing). For non-secret fields
    like a store domain or ad account ID."""
    node = config
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def resolve_env(config: dict, *keys: str) -> str | None:
    """Like get_value, but the value found is an ENV VAR NAME, not the
    credential itself -- looks it up in os.environ. Only used for values
    that are genuinely local/bootstrap, not per-client secrets (those use
    resolve_secret instead)."""
    node = get_value(config, *keys)
    if not isinstance(node, str):
        return None
    return os.environ.get(node)


def resolve_secret(conn, config: dict, *keys: str) -> str | None:
    """Like get_value, but the value found is a VAULT SECRET NAME -- looks
    it up in Supabase Vault via the given (already-open) DB connection.

    Example: resolve_secret(conn, config, "shopify", "access_token_secret")
    looks up config["shopify"]["access_token_secret"] (e.g.
    "dev_test.shopify.access_token"), then returns that secret's decrypted
    value from vault.decrypted_secrets.
    """
    node = get_value(config, *keys)
    if not isinstance(node, str):
        return None
    return get_secret(conn, node)
