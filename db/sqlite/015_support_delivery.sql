ALTER TABLE support_tickets ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX support_ticket_request_idx ON support_tickets(request_key);
CREATE TABLE support_rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, reset_at TEXT NOT NULL);
