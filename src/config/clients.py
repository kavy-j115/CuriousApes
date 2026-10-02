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
    """Returns one dict per client, each with a resolved 'client_id' at
    minimum.

    Sources, in order: config/clients/*.yaml (legacy/bootstrap, e.g.
    dev_test), then the `clients` table when `conn` is given. The database
    is the source of truth for everything it holds, OVERLAID on top of any
    YAML for the same client_id:
    - thresholds / notifications.whatsapp_recipients (sql/018)
    - data-source connection identifiers: shopify.store_domain,
      meta_ads.ad_account_id, ga4.property_id (sql/020) -- credentials are
      never stored here; the *_secret fields name Vault secrets, with the
      same per-client / shared-agency naming the YAML template documents
    - sync_enabled: a client switched off in the admin UI stays in the list
      (callers decide what to do) but is marked config["sync_enabled"] =
      False. A client that exists only as YAML, with no database row, is
      treated as enabled -- unchanged legacy behavior.
    A client that exists only in the database (onboarded entirely through
    the admin UI, no YAML at all) is included too.

    Every existing caller of get_value(config, "thresholds") /
    get_value(config, "notifications", "whatsapp_recipients") keeps working
    unchanged, since this merges into the same dict shape they expect."""
    by_id: dict[str, dict] = {}
    for path in sorted(CONFIG_DIR.glob("*.yaml")):
        with open(path) as f:
            config = yaml.safe_load(f)
        if config and config.get("client_id"):
            by_id[config["client_id"]] = config

    if conn is not None:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT client_id, display_name, alert_thresholds, whatsapp_recipients,
                   shopify_store_domain, meta_ad_account_id, ga4_property_id, sync_enabled
            FROM clients ORDER BY client_id;
            """
        )
        rows = cur.fetchall()
        # A client with its own Meta System User stores its token as
        # "<client_id>.meta_ads.access_token"; everyone else uses the shared
        # agency token. Names only -- no secret value is read here.
        cur.execute("SELECT name FROM vault.secrets WHERE name LIKE %s;", ("%.meta_ads.access_token",))
        own_meta_token = {name for (name,) in cur.fetchall()}
        for (client_id, display_name, alert_thresholds, whatsapp_recipients,
             store_domain, ad_account_id, ga4_property_id, sync_enabled) in rows:
            config = by_id.setdefault(client_id, {"client_id": client_id, "display_name": display_name})
            config["thresholds"] = alert_thresholds or {}
            config["notifications"] = {"whatsapp_recipients": list(whatsapp_recipients or [])}
            config["sync_enabled"] = bool(sync_enabled)

            if store_domain:
                shopify = config.setdefault("shopify", {})
                shopify["store_domain"] = store_domain
                shopify.setdefault("access_token_secret", f"{client_id}.shopify.access_token")
            if ad_account_id:
                meta = config.setdefault("meta_ads", {})
                meta["ad_account_id"] = ad_account_id
                own = f"{client_id}.meta_ads.access_token"
                meta.setdefault("access_token_secret", own if own in own_meta_token else "agency.meta_ads.access_token")
            if ga4_property_id:
                ga4 = config.setdefault("ga4", {})
                ga4["property_id"] = ga4_property_id
                ga4.setdefault("service_account_secret", "agency.ga4.service_account_json")
        cur.close()

    return list(by_id.values())


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
