-- Matching / table assignment (minimal for A) — PostgreSQL production
CREATE TYPE table_assignment_status AS ENUM ('PENDING', 'CONFIRMED', 'REALLOCATED', 'EXCEPTION');
CREATE TABLE table_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  assigned_user_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX table_assignments_event_idx ON table_assignments(event_id);
CREATE INDEX table_assignments_event_table_idx ON table_assignments(event_id, table_name);
