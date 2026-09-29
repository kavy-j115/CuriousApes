-- Milestone 8: raw layer for Meta Ads daily insights.
CREATE TABLE IF NOT EXISTS raw_meta_insights (
    id             BIGSERIAL PRIMARY KEY,
    client_id      TEXT NOT NULL REFERENCES clients(client_id),
    ad_account_id  TEXT NOT NULL,
    insight_date   DATE NOT NULL,
    raw_data       JSONB NOT NULL,
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, ad_account_id, insight_date)
);

CREATE INDEX IF NOT EXISTS idx_raw_meta_insights_client ON raw_meta_insights(client_id);
