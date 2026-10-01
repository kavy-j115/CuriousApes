-- Moves alert thresholds and WhatsApp recipients from config/clients/*.yaml
-- into the database -- the one piece of per-client config that's
-- genuinely operational (an admin should be able to change it from the
-- web UI when onboarding a client) rather than a credential or identifier
-- that belongs in git-tracked config (see docs/secrets.md for why
-- Shopify/Meta/GA4 config stays in YAML -- that reasoning doesn't apply
-- here, since neither of these is a secret or a system identifier).
--
-- NULL/empty stays the existing "not configured" behavior (alerts/DHR
-- skip, not error) -- same meaning as a missing `thresholds:` block in
-- YAML before this migration.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS alert_thresholds JSONB;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_recipients TEXT[] NOT NULL DEFAULT '{}';
