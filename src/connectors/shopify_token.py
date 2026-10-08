"""Shopify access tokens for the pipeline, including the expiring ones a PUBLIC app gets.

A custom-distribution app (what we use today) has a token that never expires, stored in Vault
as plain text under "<client>.shopify.access_token". A public app must use EXPIRING offline
tokens: the access token lasts about an hour, and comes with a refresh token (about 90 days)
that is swapped for a new pair on every refresh -- the old refresh token stops working.
Such a token is stored in the same Vault secret as a small JSON document:

    {"access_token": "...", "refresh_token": "...",
     "expires_at": "2026-10-08T10:00:00+00:00", "refresh_expires_at": "2027-01-06T09:00:00+00:00"}

get_shopify_access_token() hands back a token that works right now. For a plain-text secret it
just returns it. For a JSON one it refreshes first when the access token is about to expire,
and saves the new pair BEFORE anything else uses it (a lost refresh token cannot be recovered;
the store would have to be reinstalled). A database advisory lock makes sure two runs never
refresh the same store at the same time.

The refresh call is Shopify's OAuth token exchange -- the same kind of call as the install,
and the only non-read call this module makes. It needs the app's client id and secret, kept
in Vault as agency.shopify.client_id and agency.shopify.client_secret.
"""

import json
from datetime import datetime, timedelta, timezone

import requests

from src.config.clients import get_value, resolve_secret
from src.config.vault import get_secret, set_secret

REFRESH_MARGIN = timedelta(minutes=5)
CLIENT_ID_SECRET = "agency.shopify.client_id"
CLIENT_SECRET_SECRET = "agency.shopify.client_secret"


class ShopifyTokenError(Exception):
    pass


def _parse(raw: str) -> dict | None:
    if not raw.lstrip().startswith("{"):
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) and "access_token" in data else None


def _fresh(bundle: dict, now: datetime) -> bool:
    try:
        return datetime.fromisoformat(bundle["expires_at"]) - REFRESH_MARGIN > now
    except (KeyError, ValueError):
        return False


def _refresh(conn, secret_name: str, store_domain: str, bundle: dict, now: datetime) -> dict:
    client_id = get_secret(conn, CLIENT_ID_SECRET)
    client_secret = get_secret(conn, CLIENT_SECRET_SECRET)
    if not client_id or not client_secret:
        raise ShopifyTokenError(f"The Shopify app's client id/secret are not in Vault ({CLIENT_ID_SECRET}, {CLIENT_SECRET_SECRET}).")
    refresh_token = bundle.get("refresh_token")
    if not refresh_token:
        raise ShopifyTokenError("This store's token has no refresh token; the store must be reinstalled.")
    try:
        if datetime.fromisoformat(bundle["refresh_expires_at"]) <= now:
            raise ShopifyTokenError("The refresh token has expired; the store must be reinstalled.")
    except (KeyError, ValueError):
        pass

    response = requests.post(
        f"https://{store_domain}/admin/oauth/access_token",
        json={"client_id": client_id, "client_secret": client_secret, "refresh_token": refresh_token},
        headers={"Accept": "application/json"},
        timeout=30,
    )
    if not response.ok:
        raise ShopifyTokenError(
            f"Shopify refused to refresh the token (HTTP {response.status_code}); the store may need to be reinstalled."
        )
    body = response.json()
    if not body.get("access_token") or not body.get("refresh_token"):
        raise ShopifyTokenError("Shopify's refresh answer did not contain a new token pair.")
    new_bundle = {
        "access_token": body["access_token"],
        "refresh_token": body["refresh_token"],
        "expires_at": (now + timedelta(seconds=int(body.get("expires_in", 3600)))).isoformat(),
        "refresh_expires_at": (now + timedelta(seconds=int(body.get("refresh_token_expires_in", 7776000)))).isoformat(),
    }
    # Saved immediately: the old refresh token is already dead.
    set_secret(conn, secret_name, json.dumps(new_bundle), "Shopify expiring token pair (refreshed)")
    return new_bundle


def get_shopify_access_token(conn, config: dict, client_id: str, store_domain: str) -> str | None:
    """A token that works right now for this client's store, or None if none is stored."""
    secret_name = get_value(config, "shopify", "access_token_secret")
    raw = resolve_secret(conn, config, "shopify", "access_token_secret")
    if not raw or not isinstance(secret_name, str):
        return None
    bundle = _parse(raw)
    if bundle is None:
        return raw  # a plain, non-expiring token
    now = datetime.now(timezone.utc)
    if _fresh(bundle, now):
        return bundle["access_token"]

    cur = conn.cursor()
    cur.execute("SELECT pg_advisory_lock(hashtext(%s));", (f"shopify_refresh:{client_id}",))
    try:
        # Someone else may have refreshed while we waited for the lock.
        again = _parse(get_secret(conn, secret_name) or "")
        if again is not None and _fresh(again, datetime.now(timezone.utc)):
            return again["access_token"]
        return _refresh(conn, secret_name, store_domain, again or bundle, datetime.now(timezone.utc))["access_token"]
    finally:
        cur.execute("SELECT pg_advisory_unlock(hashtext(%s));", (f"shopify_refresh:{client_id}",))
        conn.commit()
        cur.close()
