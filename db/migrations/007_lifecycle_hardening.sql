-- Lifecycle hardening: attendance may recur across non-overlapping events.
DROP INDEX IF EXISTS table_members_active_user_idx;
CREATE TABLE IF NOT EXISTS lifecycle_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, entity_id text,
  error text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
