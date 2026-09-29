-- Stores generated AI Analyst reports so they're queryable/displayable
-- later without redesign, rather than only ever printed to a terminal.
CREATE TABLE IF NOT EXISTS ai_daily_reports (
    id             BIGSERIAL PRIMARY KEY,
    client_id      TEXT NOT NULL REFERENCES clients(client_id),
    report_date    DATE NOT NULL,
    content        TEXT NOT NULL,
    model          TEXT NOT NULL,
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, report_date)
);
