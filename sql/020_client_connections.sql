-- Per-client data-source connection details move from config/clients/*.yaml
-- into the database, so onboarding a client is a form in the admin UI
-- instead of a git commit. Identifiers only -- credentials stay in Vault.
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS shopify_store_domain TEXT,
    ADD COLUMN IF NOT EXISTS meta_ad_account_id   TEXT,
    ADD COLUMN IF NOT EXISTS ga4_property_id      TEXT,
    ADD COLUMN IF NOT EXISTS shopify_connected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_enabled         BOOLEAN NOT NULL DEFAULT false;

-- New clients start disabled so nothing is fetched until it's switched on
-- deliberately; clients that existed when this ran were switched on once
-- (diruno-fashion was then switched back off by hand -- it was created
-- before this migration and must not fetch until given the go signal).
UPDATE clients SET sync_enabled = true;

-- The web app's OAuth callback has to write/read Vault, which isn't exposed
-- through PostgREST. These wrappers are callable by service_role only
-- (revoked from everyone else), the same trust level as the service key the
-- web server already holds.
CREATE OR REPLACE FUNCTION public.set_vault_secret(p_name TEXT, p_value TEXT, p_description TEXT DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    existing_id UUID;
BEGIN
    SELECT id INTO existing_id FROM vault.secrets WHERE name = p_name;
    IF existing_id IS NULL THEN
        PERFORM vault.create_secret(p_value, p_name, p_description);
    ELSE
        PERFORM vault.update_secret(existing_id, p_value);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_vault_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name;
$$;

REVOKE ALL ON FUNCTION public.set_vault_secret(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_vault_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_vault_secret(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vault_secret(TEXT) TO service_role;
