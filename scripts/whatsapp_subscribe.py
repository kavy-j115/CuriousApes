"""One-time WhatsApp setup: subscribes the Meta app to a WhatsApp Business
Account, so Meta delivers that account's incoming messages to the webhook
(web/src/app/api/whatsapp/webhook). The webhook URL itself is configured in
the Meta app dashboard; this is the separate "account -> app" link.

Uses the access token already in Vault (agency.whatsapp.access_token), so no
token is typed or printed. Sends nothing to anyone and reads no client data.

Run with: venv/Scripts/python scripts/whatsapp_subscribe.py <WABA_ID>
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
import requests
from dotenv import load_dotenv

from src.config.vault import get_secret
from src.notifications.whatsapp import GRAPH_API_VERSION

load_dotenv()


def main():
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        print("Usage: whatsapp_subscribe.py <WhatsApp Business Account ID, digits only>")
        sys.exit(1)
    waba_id = sys.argv[1]

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    token = get_secret(conn, "agency.whatsapp.access_token")
    conn.close()
    if not token:
        print("agency.whatsapp.access_token isn't in Vault yet.")
        sys.exit(1)

    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{waba_id}/subscribed_apps"
    headers = {"Authorization": f"Bearer {token}"}

    post = requests.post(url, headers=headers, timeout=20)
    print(f"Subscribe: HTTP {post.status_code} {post.text}")

    check = requests.get(url, headers=headers, timeout=20)
    print(f"Subscribed apps now: HTTP {check.status_code} {check.text}")


if __name__ == "__main__":
    main()
