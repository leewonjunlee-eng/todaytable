-- Attendance / feedback (Step D) — PostgreSQL production
CREATE TYPE attendance_status AS ENUM ('SCHEDULED', 'ATTENDED', 'CANCELED_EARLY', 'CANCELED_LATE', 'NO_SHOW');
CREATE TABLE attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status attendance_status NOT NULL DEFAULT 'SCHEDULED',
  feedback_score int CHECK (feedback_score BETWEEN 1 AND 5),
  feedback_text text,
  checked_by uuid REFERENCES users(id),
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_app_idx ON attendance_records(application_id);
CREATE INDEX attendance_event_idx ON attendance_records(event_id);
