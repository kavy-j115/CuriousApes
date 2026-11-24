-- A store that installs the public app on its own (not added by an admin first) gets a client row
-- created automatically so the install can complete. Such a client is "pending approval": sync is
-- off and nothing is fetched until an admin approves it on the Clients page.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT false;
