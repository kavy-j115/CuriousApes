"""One-time migration: moves dev_test's existing plaintext .env credentials
into Supabase Vault under the new naming convention, so config/clients/
dev_test.yaml's access_token_secret fields resolve correctly.

Reads values from the current environment and writes them straight to
Vault -- never printed, never passed as a command-line argument.

Run with: venv/Scripts/python scripts/migrate_dev_test_secrets_to_vault.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
import psycopg2

from src.config.vault import set_secret

load_dotenv()


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])

    migrations = [
        ("SHOPIFY_ACCESS_TOKEN", "dev_test.shopify.access_token"),
        ("META_ACCESS_TOKEN", "dev_test.meta_ads.access_token"),
    ]

    for env_var, vault_name in migrations:
        value = os.environ.get(env_var)
        if not value:
            print(f"skip   {vault_name} ({env_var} not set)")
            continue
        set_secret(conn, vault_name, value, description=f"migrated from .env {env_var}")
        print(f"stored {vault_name}")

    conn.close()
    print("done. You can now remove SHOPIFY_ACCESS_TOKEN/META_ACCESS_TOKEN from .env")
    print("(run scripts/remove_env_keys.py to do that safely, without ever printing the values).")


if __name__ == "__main__":
    main()
