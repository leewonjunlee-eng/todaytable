-- Provisioning and push delivery state. Matching never performs venue side effects.
ALTER TABLE dining_tables ADD COLUMN provision_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (provision_status IN ('PENDING','PROVISIONED','EXCEPTION'));
ALTER TABLE dining_tables ADD COLUMN provision_attempts INTEGER NOT NULL DEFAULT 0;
CREATE TABLE push_deliveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','DISABLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  UNIQUE(job_id,subscription_id)
);