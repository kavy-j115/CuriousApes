"""Loads config/clients/*.yaml -- one file per brand this agency manages.

Each file's top-level keys (shopify, meta_ads, ga4) name which data sources
are configured for that client, and each source's *_env fields name the
environment variable holding the real credential. This indirection is what
lets the same code run against many clients later: add a new client's
brand.yaml, add its own uniquely-named env vars, and the pipeline picks it
up automatically -- no code changes.
"""

import os
from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config" / "clients"


def load_all() -> list[dict]:
    """Returns one dict per client config file, each with a resolved
    'client_id' at minimum. Skips a file if its client_id is missing."""
    clients = []
    for path in sorted(CONFIG_DIR.glob("*.yaml")):
        with open(path) as f:
            config = yaml.safe_load(f)
        if config and config.get("client_id"):
            clients.append(config)
    return clients


def resolve_env(config: dict, *keys: str) -> str | None:
    """Walks a dotted path of keys into config, then looks up the env var
    named by the value found there. Returns None if any step is missing --
    callers treat that as "this client doesn't have this source configured",
    not an error.

    Example: resolve_env(config, "shopify", "access_token_env") looks up
    config["shopify"]["access_token_env"] (e.g. "SHOPIFY_ACCESS_TOKEN"),
    then returns os.environ["SHOPIFY_ACCESS_TOKEN"].
    """
    node = config
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    if not isinstance(node, str):
        return None
    return os.environ.get(node)
