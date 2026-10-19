CREATE TABLE table_content_templates (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, atmosphere TEXT NOT NULL DEFAULT 'ANY' CHECK(atmosphere IN ('ANY','BALANCED','LIVELY','CALM')),
 interest_tags TEXT NOT NULL DEFAULT '[]', topics TEXT NOT NULL, game TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT TRUE, priority INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX table_content_rule_idx ON table_content_templates(enabled,priority);
