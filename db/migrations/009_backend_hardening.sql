-- Additive backend hardening. Historical migrations remain immutable.
ALTER TABLE journey_messages ALTER COLUMN author_user_id DROP NOT NULL;
ALTER TABLE journey_messages ALTER COLUMN request_key TYPE text USING request_key::text;
ALTER TABLE journey_messages ADD COLUMN kind text NOT NULL DEFAULT 'USER';
ALTER TABLE events ADD COLUMN ends_at timestamptz;
ALTER TABLE events ADD COLUMN schedule_version integer NOT NULL DEFAULT 1;
ALTER TABLE dining_tables ADD COLUMN schedule_version integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN restricted_status text NOT NULL DEFAULT 'ACTIVE' CHECK (restricted_status IN ('ACTIVE','SUSPENDED','PERMANENT'));
ALTER TABLE lifecycle_exceptions ADD COLUMN status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','RETRYING'));
ALTER TABLE lifecycle_exceptions ADD COLUMN resolved_at timestamptz;
ALTER TABLE lifecycle_exceptions ADD COLUMN resolved_by uuid REFERENCES users(id);
ALTER TABLE matching_rules ADD COLUMN immutable_version text;
UPDATE matching_rules SET immutable_version=version WHERE immutable_version IS NULL;
CREATE TABLE IF NOT EXISTS matching_rule_versions (
  version text PRIMARY KEY, min_score numeric NOT NULL, weights jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id)
);
INSERT INTO matching_rule_versions(version,min_score,weights)
 SELECT version,min_score,weights FROM matching_rules ON CONFLICT(version) DO NOTHING;
CREATE INDEX IF NOT EXISTS journey_messages_cursor_idx ON journey_messages(room_id,created_at,id);
UPDATE events SET ends_at=starts_at + interval '2 hours' WHERE ends_at IS NULL;
UPDATE journey_messages SET kind='SYSTEM', author_user_id=NULL WHERE request_key LIKE '%:system:%';
