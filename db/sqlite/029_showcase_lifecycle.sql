CREATE TABLE showcase_batches (
 id TEXT PRIMARY KEY, dataset_sha256 TEXT NOT NULL, anchor_date TEXT NOT NULL,
 active BOOLEAN NOT NULL DEFAULT false, summary TEXT NOT NULL DEFAULT '{}',
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX showcase_one_active ON showcase_batches(active) WHERE active=true;
CREATE TABLE showcase_members (
 batch_id TEXT NOT NULL REFERENCES showcase_batches(id), dataset_sha256 TEXT NOT NULL,
 sheet_name TEXT NOT NULL, sheet_row INTEGER NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 application_id TEXT NOT NULL REFERENCES applications(id), payment_id TEXT NOT NULL REFERENCES payments(id),
 event_id TEXT NOT NULL REFERENCES events(id), cohort TEXT NOT NULL CHECK(cohort IN ('PAST','UPCOMING','RECRUITING')),
 assumptions TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(batch_id,dataset_sha256,sheet_name,sheet_row),
 UNIQUE(batch_id,user_id), UNIQUE(application_id)
);
CREATE TABLE showcase_viewers (
 batch_id TEXT NOT NULL REFERENCES showcase_batches(id), user_id TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(batch_id,user_id)
);
