-- Every client store is in India: day boundaries (and "today" for the last
-- 7/30 day views) follow IST unless a client is explicitly set otherwise.
ALTER TABLE clients ALTER COLUMN timezone SET DEFAULT 'Asia/Kolkata';
UPDATE clients SET timezone = 'Asia/Kolkata' WHERE timezone = 'UTC';
