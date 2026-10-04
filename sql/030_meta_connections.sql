-- "Connect Meta": an agency person logs in with Facebook once (Facebook Login on the
-- Meta app), and the app can then read every ad account that person can reach. The
-- long-lived token itself is in Vault; these tables hold what is safe to show:
-- who connected, when the token expires, and the ad accounts it can see.
CREATE TABLE IF NOT EXISTS meta_connections (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fb_user_id    TEXT NOT NULL UNIQUE,
    fb_user_name  TEXT,
    secret_name   TEXT NOT NULL,            -- Vault secret holding the token
    expires_at    TIMESTAMPTZ,              -- long-lived user tokens last about 60 days
    connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meta_ad_accounts (
    account_id     TEXT PRIMARY KEY,
    name           TEXT,
    business_name  TEXT,
    account_status INT,                     -- Meta's code, 1 = active
    connection_id  UUID NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ad_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_connections_admin_read ON meta_connections;
CREATE POLICY meta_connections_admin_read ON meta_connections FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS meta_ad_accounts_admin_read ON meta_ad_accounts;
CREATE POLICY meta_ad_accounts_admin_read ON meta_ad_accounts FOR SELECT USING (is_admin());

-- Removing a connection also removes its stored token. Service role only, like
-- set_vault_secret / get_vault_secret (sql/020).
CREATE OR REPLACE FUNCTION public.delete_vault_secret(p_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    DELETE FROM vault.secrets WHERE name = p_name;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_vault_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_vault_secret(TEXT) TO service_role;
