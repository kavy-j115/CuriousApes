# Secrets

## Why this exists

Before this, every per-client credential (Shopify token, Meta token) was
an environment variable, meaning a scheduled GitHub Actions run needed one
named GitHub Secret per credential per client. At 30 clients × 2-3
credentials each, that's 60-90 individually-managed secrets, close to
GitHub's ~100-per-repo limit, and operationally painful (onboarding a new
client shouldn't mean clicking through GitHub's secrets UI by hand).

## The split: identifiers vs. credentials

Two different kinds of values live in `config/clients/*.yaml`, handled
differently on purpose:

- **Identifiers** (a Shopify store domain, a Meta ad account ID) aren't
  secret — useless to anyone without the credential alongside them. These
  are plain values, right in the committed YAML file.
- **Credentials** (access tokens, service account keys) are never stored
  in a file at all. A field like `access_token_secret` names a secret
  stored in **Supabase Vault** — Postgres-native encrypted secret storage
  (the `supabase_vault` extension, built on `pgsodium`).

```yaml
shopify:
  store_domain: acme.myshopify.com        # identifier -- plain, committed
  access_token_secret: acme.shopify.access_token   # names a Vault secret
```

## Why Vault specifically, not a custom encryption scheme

We deliberately did not roll our own encryption. Vault is a Postgres
extension already enabled on this Supabase project — `vault.create_secret()`
and `vault.decrypted_secrets` handle the actual cryptography, key
management, and storage; we only call the interface. Confirmed before
building against it:

- `vault.decrypted_secrets` grants `SELECT` to the `postgres` and
  `service_role` database roles **only**. The `anon` role our Next.js web
  app authenticates as is **not** in that grant list — the web app has no
  path to read a raw credential, even by mistake in a future RLS policy.
- Our existing `DATABASE_URL` already connects as `postgres`, so the
  pipeline needed **no new credential** to start using Vault.

## The one secret that can't move into Vault

`DATABASE_URL` itself has nowhere else to live — it's what the pipeline
uses to *reach* Postgres (and therefore Vault) in the first place. A
credential can't be stored inside the database it's used to unlock. This
is why GitHub Actions Secrets still holds exactly one entry after this
migration, not zero.

## Managing secrets

`src/config/vault.py` — `get_secret(conn, name)` / `set_secret(conn, name,
value)` (create-or-rotate by name).

`scripts/set_vault_secret.py <name>` — sets or rotates one secret
interactively. The value is entered via a hidden prompt (`getpass`), never
as a command-line argument (which would leak into shell history and
process listings) and never printed back. This is how a new client's
credentials get added — no code changes, no GitHub-side setup.

## Naming convention

`<client_id>.<source>.<field>`, e.g. `acme.shopify.access_token`,
`acme.meta_ads.access_token`, `acme.ga4.service_account_json` (the GA4
service account key is stored as its raw JSON text and `json.loads()`'d
by the caller — see src/connectors/ga4.py, which takes a parsed dict
rather than a file path specifically so the key is never written to disk).

## Migration notes

`dev_test`'s credentials were migrated from `.env` via
`scripts/migrate_dev_test_secrets_to_vault.py` (a one-time script, reads
from the environment and writes straight to Vault, never printing the
values), then the now-redundant plaintext copies were removed from `.env`
via `scripts/remove_env_keys.py` (removes lines by key name only, never
reads or prints values — safe to run on a file holding live secrets).
Verified by re-running the full pipeline after removal, confirming nothing
was still silently depending on the old environment variables.
