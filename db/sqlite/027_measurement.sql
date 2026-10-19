CREATE TABLE operator_work_sessions (
 id TEXT PRIMARY KEY, exception_id TEXT NOT NULL REFERENCES lifecycle_exceptions(id),
 table_id TEXT NOT NULL REFERENCES dining_tables(id), operator_id TEXT NOT NULL REFERENCES users(id),
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, ended_at TEXT,
 CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX operator_work_one_active ON operator_work_sessions(exception_id) WHERE ended_at IS NULL;
CREATE INDEX operator_work_period ON operator_work_sessions(ended_at,table_id);
