"""Supabase Vault: encrypted secret storage inside Postgres itself.

Used only for actual credentials (API tokens, service account keys) --
never for identifiers like a store domain or ad account ID, which aren't
secret and stay as plain values in config/clients/*.yaml. See docs/secrets.md
for the full reasoning and the naming convention used for secret names.

Reachable via the same DATABASE_URL the pipeline already uses to connect to
Postgres (as the 'postgres' role). Confirmed before building this: Supabase
grants SELECT on vault.decrypted_secrets to 'postgres' and 'service_role'
only -- the anon key our Next.js web app uses is not in that grant list,
so the web app has no path to read a raw credential even by mistake.
"""


def get_secret(conn, name: str) -> str | None:
    cur = conn.cursor()
    cur.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = %s;", (name,))
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def set_secret(conn, name: str, value: str, description: str = "") -> None:
    """Creates the secret if 'name' doesn't exist yet, otherwise rotates its
    value in place (same secret id, so anything that already reads it by
    name keeps working)."""
    cur = conn.cursor()
    cur.execute("SELECT id FROM vault.secrets WHERE name = %s;", (name,))
    row = cur.fetchone()
    if row:
        cur.execute("SELECT vault.update_secret(%s, %s);", (row[0], value))
    else:
        cur.execute("SELECT vault.create_secret(%s, %s, %s);", (value, name, description))
    conn.commit()
    cur.close()
