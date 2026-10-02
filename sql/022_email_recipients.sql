-- Per-client email recipients for report delivery (manual send for now --
-- see scripts/email_report.py). Same idea as whatsapp_recipients.
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS email_recipients TEXT[] NOT NULL DEFAULT '{}';
