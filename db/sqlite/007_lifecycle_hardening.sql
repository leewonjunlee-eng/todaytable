-- Lifecycle hardening: attendance may recur across non-overlapping events.
DROP INDEX IF EXISTS table_members_active_user_idx;
CREATE TABLE IF NOT EXISTS lifecycle_exceptions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, entity_id TEXT,
  error TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
