-- Notifications / announcements (Step C) — SQLite local
CREATE TABLE notifications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'IN_APP',
  status TEXT NOT NULL DEFAULT 'SENT',
  sent_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX notifications_event_idx ON notifications(event_id);
CREATE INDEX notifications_user_idx ON notifications(recipient_user_id);
