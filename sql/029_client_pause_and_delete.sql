-- Pausing a client ("Disconnect" on the Clients page): the client is hidden from
-- every screen and nothing is fetched, but its credentials and stored history are
-- kept. When it is reconnected, the next run backfills the days that were missed.
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS paused_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS backfill_from DATE;

-- Permanent removal: the client, ALL of its stored data and its saved credentials
-- (Vault secrets named "<client_id>.*"), in one transaction. Callable by the web
-- server's service role only, after it has checked the caller is an admin.
CREATE OR REPLACE FUNCTION public.delete_client_completely(p_client_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    DELETE FROM ai_daily_reports      WHERE client_id = p_client_id;
    DELETE FROM alerts                WHERE client_id = p_client_id;
    DELETE FROM orders                WHERE client_id = p_client_id;  -- line items cascade
    DELETE FROM customers             WHERE client_id = p_client_id;
    DELETE FROM raw_ga4_sessions      WHERE client_id = p_client_id;
    DELETE FROM raw_meta_insights     WHERE client_id = p_client_id;
    DELETE FROM raw_shopify_orders    WHERE client_id = p_client_id;
    DELETE FROM shopify_daily_sales   WHERE client_id = p_client_id;
    DELETE FROM shopify_daily_sessions WHERE client_id = p_client_id;
    DELETE FROM client_access         WHERE client_id = p_client_id;
    DELETE FROM clients               WHERE client_id = p_client_id;
    DELETE FROM vault.secrets         WHERE starts_with(name, p_client_id || '.');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_completely(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_completely(TEXT) TO service_role;
