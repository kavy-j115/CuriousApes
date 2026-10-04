"""Read-only look at the Meta tokens stored in Vault: what kind of token each is,
whether it expires, its permissions, and which ad accounts it can see. Prints
metadata only -- never a token. Used to decide how "Connect Meta" should work.

Makes a few read-only Meta Graph calls (debug_token and /me/adaccounts), so only
run it when told to.

Run with: venv/Scripts/python scripts/inspect_meta_tokens.py
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
import requests
from dotenv import load_dotenv

from src.config.vault import get_secret
from src.notifications.whatsapp import GRAPH_API_VERSION

load_dotenv()

APP_ID = "1663660461993023"  # the "report automation" Meta app (not a secret)
TOKEN_NAMES = ["agency.meta_ads.access_token", "diruno-fashion.meta_ads.access_token"]
GRAPH = f"https://graph.facebook.com/{GRAPH_API_VERSION}"


def describe(token: str, app_secret: str | None) -> None:
    if app_secret:
        r = requests.get(
            f"{GRAPH}/debug_token",
            params={"input_token": token, "access_token": f"{APP_ID}|{app_secret}"},
            timeout=20,
        )
        if r.ok:
            d = r.json().get("data", {})
            exp = d.get("expires_at")
            expiry = "never" if not exp else datetime.fromtimestamp(exp, timezone.utc).strftime("%Y-%m-%d")
            print(f"  type: {d.get('type')}   valid: {d.get('is_valid')}   expires: {expiry}")
            print(f"  app: {d.get('application')}   scopes: {', '.join(d.get('scopes', []))}")
        else:
            print(f"  debug_token failed: HTTP {r.status_code}")
    else:
        print("  (META_APP_SECRET not set -- skipping debug_token)")

    r = requests.get(
        f"{GRAPH}/me/adaccounts",
        params={"fields": "account_id,name,business{name}", "limit": 100},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if not r.ok:
        print(f"  /me/adaccounts failed: HTTP {r.status_code}")
        return
    accounts = r.json().get("data", [])
    print(f"  ad accounts visible: {len(accounts)}")
    for a in accounts:
        owner = (a.get("business") or {}).get("name", "-")
        print(f"    {a.get('account_id')}  {a.get('name')}  (business: {owner})")


def main() -> None:
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    app_secret = os.environ.get("META_APP_SECRET")
    for name in TOKEN_NAMES:
        print(f"\n{name}")
        token = get_secret(conn, name)
        if not token:
            print("  not found")
            continue
        describe(token, app_secret)
    conn.close()


if __name__ == "__main__":
    main()
