-- Raw layer for GA4 daily session/ecommerce metrics.
CREATE TABLE IF NOT EXISTS raw_ga4_sessions (
    id             BIGSERIAL PRIMARY KEY,
    client_id      TEXT NOT NULL REFERENCES clients(client_id),
    property_id    TEXT NOT NULL,
    session_date   DATE NOT NULL,
    raw_data       JSONB NOT NULL,
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, property_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_raw_ga4_sessions_client ON raw_ga4_sessions(client_id);
