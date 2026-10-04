-- How far back a NEW client's first Shopify sync (bulk export) goes, chosen when the
-- client is added: 1 to 60 days (60 is Shopify's order window), or 0 = the current
-- month so far. Existing clients are unaffected (their first sync is already done).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS initial_backfill_days INTEGER NOT NULL DEFAULT 60
    CHECK (initial_backfill_days BETWEEN 0 AND 60);
