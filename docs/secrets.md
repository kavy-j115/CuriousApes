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
`acme.ga4.service_account_json` (the GA4 service account key is stored as
its raw JSON text and `json.loads()`'d by the caller — see
src/connectors/ga4.py, which takes a parsed dict rather than a file path
specifically so the key is never written to disk).

**Meta and GA4 are the exceptions: one shared secret each, not
per-client.** `agency.meta_ads.access_token` and
`agency.ga4.service_account_json`, referenced by every client's
`access_token_secret`/`service_account_secret` field, not a unique name
each. This is safe because Shopify scopes access fundamentally
differently from the other two: a Shopify custom app's token is
physically tied to the one store that created it and can never
authenticate against another. A Meta System User's token, and a GA4
service account's identity, aren't scoped that way at all — one System
User can be granted access to many ad accounts across many Business
Managers, and one service account can be granted Viewer access to many
GA4 properties across many Google accounts. Both platforms check
permission per-request ("does this identity have access to *this
specific* account/property"), not per-credential. So one credential
already legitimately works for every client who's granted it access — no
code change was needed for either, only pointing every client's config at
the same secret name.

**The trade-off, stated plainly, not just the upside:** if this one token
is ever compromised, an attacker reads every client's ad data in one
shot, not just one client's — a larger blast radius than per-client
tokens would have. There's a subtler cost too: a bug in our own code that
queries the *wrong* client's `ad_account_id` would, with a per-client
token, simply fail (no permission) — with the shared token, that same bug
would silently succeed, leaking one client's data into another's report.
Per-client tokens are a real safety net against our own mistakes, not
just security theater. Chosen anyway because RLS already protects the
database layer independently, and the onboarding-friction savings are
real — but this is a considered trade, not a strictly-better change.

**Onboarding a new client's Meta access now needs zero new credentials at
all:** they approve a Business Manager access request on Meta's side (a
few clicks, no API/token knowledge required), you add their
`ad_account_id` to their config file. Compare this to Shopify, which still
needs a real token generated per client until a proper OAuth app exists
(see docs/architecture.md's future-work notes) — Shopify's per-store
token scoping means there's no equivalent shortcut available today.

## Migration notes

`dev_test`'s credentials were migrated from `.env` via
`scripts/migrate_dev_test_secrets_to_vault.py` (a one-time script, reads
from the environment and writes straight to Vault, never printing the
values), then the now-redundant plaintext copies were removed from `.env`
via `scripts/remove_env_keys.py` (removes lines by key name only, never
reads or prints values — safe to run on a file holding live secrets).
Verified by re-running the full pipeline after removal, confirming nothing
was still silently depending on the old environment variables.
