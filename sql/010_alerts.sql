-- Stores triggered alerts so they're queryable/displayable later, same
-- pattern as ai_daily_reports.
CREATE TABLE IF NOT EXISTS alerts (
    id            BIGSERIAL PRIMARY KEY,
    client_id     TEXT NOT NULL REFERENCES clients(client_id),
    alert_date    DATE NOT NULL,
    alert_type    TEXT NOT NULL,   -- 'revenue_drop' | 'cac_increase' | 'roas_drop' | 'sync_failure'
    message       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, alert_date, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_alerts_client_date ON alerts(client_id, alert_date);
