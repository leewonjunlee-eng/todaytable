-- Core lifecycle: additive matching snapshots, table membership, and resolution state.
CREATE TABLE match_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id),
  rule_version text NOT NULL, seed text NOT NULL, input_snapshot jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
  matched_count integer NOT NULL DEFAULT 0, quality_score numeric NOT NULL DEFAULT 0,
  failure_reason text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX match_runs_event_idx ON match_runs(event_id,created_at DESC);
CREATE TABLE dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id),
  match_run_id uuid NOT NULL REFERENCES match_runs(id), table_number integer NOT NULL,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','EXCEPTION','CANCELLED')),
  quality_score numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,table_number)
);
CREATE TABLE table_members (
  table_id uuid NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id), user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REMOVED')),
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(table_id,user_id)
);
CREATE UNIQUE INDEX table_members_active_application_idx ON table_members(application_id) WHERE status='ACTIVE';
CREATE TABLE match_explanations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_run_id uuid NOT NULL REFERENCES match_runs(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id), table_id uuid REFERENCES dining_tables(id),
  kind text NOT NULL, message text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resolution_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL UNIQUE REFERENCES applications(id),
  status text NOT NULL DEFAULT 'OFFERED' CHECK(status IN ('OFFERED','TRANSFERRED','HELD','REFUND_REQUESTED','REFUND_PROCESSING','REFUNDED','FAILED')),
  version integer NOT NULL DEFAULT 0, reason text NOT NULL, alternatives jsonb NOT NULL DEFAULT '[]',
  selected_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE resolution_cases ADD COLUMN selected_choice text;
ALTER TABLE resolution_cases ADD COLUMN result_payload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE resolution_cases ADD COLUMN transferred_event_id uuid REFERENCES events(id);
CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resolution_id uuid UNIQUE REFERENCES resolution_cases(id),
  payment_id uuid NOT NULL REFERENCES payments(id), status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','PROCESSING','COMPLETED','FAILED')),
  request_key text NOT NULL UNIQUE, amount_cents integer NOT NULL DEFAULT 0, error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX table_members_user_idx ON table_members(user_id,status);
CREATE INDEX resolution_status_idx ON resolution_cases(status);
CREATE TABLE IF NOT EXISTS lifecycle_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, entity_id text,
  error text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE match_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_user_id uuid NOT NULL REFERENCES users(id),
  target_user_id uuid NOT NULL REFERENCES users(id), relationship_type text NOT NULL CHECK(relationship_type IN ('BLOCK','DISLIKE','REPORT')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_user_id,target_user_id,relationship_type)
);
CREATE TABLE match_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL REFERENCES dining_tables(id),
  user_id uuid NOT NULL REFERENCES users(id), other_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(table_id,user_id,other_user_id)
);
CREATE INDEX match_relationships_lookup_idx ON match_relationships(source_user_id,target_user_id,active);
