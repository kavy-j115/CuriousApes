-- Shopify's mandatory privacy webhooks for a public app.
--
--   customers/data_request : a customer asked the merchant for the data we hold on them.
--                            We log it here; a person answers it (the table is the work list).
--   customers/redact       : erase that customer's personal data  -> redact_shopify_customer()
--   shop/redact            : erase everything of a store (48 h after uninstall)
--                            -> delete_client_completely() (migration 029) via the web app
--
-- Written only by the web server (service role); admins can read the list.

CREATE TABLE IF NOT EXISTS privacy_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         TEXT NOT NULL CHECK (kind IN ('customers_data_request', 'customers_redact', 'shop_redact', 'app_uninstalled')),
    shop_domain  TEXT NOT NULL,
    client_id    TEXT,                       -- the client that store belonged to, when known
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    handled_at   TIMESTAMPTZ,                -- redactions are handled on receipt; data requests by hand
    note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_open ON privacy_requests (handled_at, received_at);

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read privacy requests" ON privacy_requests;
DROP POLICY IF EXISTS "admins update privacy requests" ON privacy_requests;
CREATE POLICY "admins read privacy requests" ON privacy_requests FOR SELECT USING ((SELECT is_admin()));
CREATE POLICY "admins update privacy requests" ON privacy_requests FOR UPDATE USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

-- Removes one customer's personal data from a store's stored history: the customer row's
-- name / email / phone, and the same fields inside the stored raw order JSON. Orders
-- themselves (amounts, products) stay, with the customer reduced to an anonymous id.
-- Returns the number of customer rows and raw orders touched.
CREATE OR REPLACE FUNCTION public.redact_shopify_customer(p_shop_domain TEXT, p_shopify_customer_id TEXT)
RETURNS TABLE (customers_redacted INT, raw_orders_redacted INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client TEXT;
    v_customers INT := 0;
    v_raw INT := 0;
BEGIN
    SELECT client_id INTO v_client FROM clients WHERE lower(shopify_store_domain) = lower(p_shop_domain);
    IF v_client IS NULL THEN
        RETURN QUERY SELECT 0, 0;
        RETURN;
    END IF;

    UPDATE customers
       SET email = NULL, phone = NULL, first_name = NULL, last_name = NULL, updated_at = now()
     WHERE client_id = v_client AND shopify_customer_id = p_shopify_customer_id;
    GET DIAGNOSTICS v_customers = ROW_COUNT;

    UPDATE raw_shopify_orders
       SET raw_data = jsonb_set(raw_data, '{customer}', jsonb_build_object('id', raw_data->'customer'->>'id'))
     WHERE client_id = v_client
       AND raw_data->'customer'->>'id' = 'gid://shopify/Customer/' || p_shopify_customer_id;
    GET DIAGNOSTICS v_raw = ROW_COUNT;

    RETURN QUERY SELECT v_customers, v_raw;
END;
$$;

REVOKE ALL ON FUNCTION public.redact_shopify_customer(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_shopify_customer(TEXT, TEXT) TO service_role;
