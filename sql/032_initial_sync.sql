-- A brand-new client's FIRST sync loads 60 days of Shopify (its order limit) but only
-- 3 days of Meta. This flag marks clients that have already had that first sync.
-- Everyone who exists today has been synced, so they are marked done; clients added
-- from now on start as false.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS initial_sync_done BOOLEAN NOT NULL DEFAULT false;
UPDATE clients SET initial_sync_done = true;
