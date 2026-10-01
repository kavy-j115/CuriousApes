-- Tracks whether an alert has actually been sent (WhatsApp), separate from
-- when it was detected. Without this, every pipeline rerun on the same day
-- would re-send the same alert every time run_pipeline.py runs, since
-- save_alerts() upserts the row on every run to keep its message current.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
