-- WhatsApp number for agency people (admins and users), so they can message the
-- report bot and receive alerts / daily reports for the clients they work on.
-- Clients' own numbers stay in clients.whatsapp_recipients.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone TEXT;
