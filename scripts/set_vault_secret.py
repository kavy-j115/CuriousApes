"""Sets (or rotates) one Supabase Vault secret, interactively -- the value
is entered via a hidden prompt (getpass), never as a command-line argument
(which would leak into shell history and process listings) and never
printed back.

Run with: venv/Scripts/python scripts/set_vault_secret.py <secret-name>
Example:  venv/Scripts/python scripts/set_vault_secret.py acme.shopify.access_token
"""

import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

from src.config.vault import set_secret

load_dotenv()


def main():
    if len(sys.argv) != 2:
        print("Usage: set_vault_secret.py <secret-name>")
        sys.exit(1)

    name = sys.argv[1]
    value = getpass.getpass(f"Value for '{name}' (input hidden, not echoed): ")

    if not value:
        print("Empty value entered, aborting.")
        sys.exit(1)

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    set_secret(conn, name, value)
    conn.close()

    print(f"Stored secret '{name}' in Supabase Vault.")


if __name__ == "__main__":
    main()
