-- Why a client is paused: NULL for a manual Disconnect, 'meta_access_lost' when the
-- agency's Meta login can no longer see the client's ad account (found by the manual
-- "Refresh list" on the Meta Accounts page). Shown on the Clients page.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pause_reason TEXT;
