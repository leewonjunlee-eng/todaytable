-- Core lifecycle: SQLite additive equivalent of PostgreSQL migration 006.
CREATE TABLE match_runs (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), rule_version TEXT NOT NULL, seed TEXT NOT NULL,
  input_snapshot TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
  matched_count INTEGER NOT NULL DEFAULT 0, quality_score REAL NOT NULL DEFAULT 0, failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE INDEX match_runs_event_idx ON match_runs(event_id,created_at DESC);
CREATE TABLE dining_tables (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), match_run_id TEXT NOT NULL REFERENCES match_runs(id),
  table_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','EXCEPTION','CANCELLED')),
  quality_score REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id,table_number)
);
CREATE TABLE table_members (
  table_id TEXT NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE, application_id TEXT NOT NULL REFERENCES applications(id),
  user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REMOVED')),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(table_id,user_id)
);
CREATE UNIQUE INDEX table_members_active_application_idx ON table_members(application_id) WHERE status='ACTIVE';
CREATE TABLE match_explanations (
  id TEXT PRIMARY KEY, match_run_id TEXT NOT NULL REFERENCES match_runs(id) ON DELETE CASCADE, application_id TEXT REFERENCES applications(id),
  table_id TEXT REFERENCES dining_tables(id), kind TEXT NOT NULL, message TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE resolution_cases (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL UNIQUE REFERENCES applications(id), status TEXT NOT NULL DEFAULT 'OFFERED'
    CHECK(status IN ('OFFERED','TRANSFERRED','HELD','REFUND_REQUESTED','REFUND_PROCESSING','REFUNDED','FAILED')),
  version INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL, alternatives TEXT NOT NULL DEFAULT '[]', selected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE resolution_cases ADD COLUMN selected_choice TEXT;
ALTER TABLE resolution_cases ADD COLUMN result_payload TEXT NOT NULL DEFAULT '{}';
ALTER TABLE resolution_cases ADD COLUMN transferred_event_id TEXT REFERENCES events(id);
CREATE TABLE refund_requests (
  id TEXT PRIMARY KEY, resolution_id TEXT NOT NULL UNIQUE REFERENCES resolution_cases(id), payment_id TEXT NOT NULL REFERENCES payments(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','PROCESSING','COMPLETED','FAILED')),
  request_key TEXT NOT NULL UNIQUE, amount_cents INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE INDEX table_members_user_idx ON table_members(user_id,status);
CREATE INDEX resolution_status_idx ON resolution_cases(status);
CREATE TABLE IF NOT EXISTS lifecycle_exceptions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, entity_id TEXT,
  error TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE match_relationships (
  id TEXT PRIMARY KEY, source_user_id TEXT NOT NULL REFERENCES users(id), target_user_id TEXT NOT NULL REFERENCES users(id),
  relationship_type TEXT NOT NULL CHECK(relationship_type IN ('BLOCK','DISLIKE','REPORT')), active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(source_user_id,target_user_id,relationship_type)
);
CREATE TABLE match_history (
  id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES dining_tables(id), user_id TEXT NOT NULL REFERENCES users(id),
  other_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(table_id,user_id,other_user_id)
);
CREATE INDEX match_relationships_lookup_idx ON match_relationships(source_user_id,target_user_id,active);
