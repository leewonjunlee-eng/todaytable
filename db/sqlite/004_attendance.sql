-- Attendance / feedback (Step D) — SQLite local
CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  feedback_score INTEGER CHECK (feedback_score BETWEEN 1 AND 5),
  feedback_text TEXT,
  checked_by TEXT REFERENCES users(id),
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX attendance_app_idx ON attendance_records(application_id);
CREATE INDEX attendance_event_idx ON attendance_records(event_id);
