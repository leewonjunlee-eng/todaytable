-- Reservation / venue confirmation (Step B) — PostgreSQL production
CREATE TYPE reservation_status AS ENUM ('PENDING', 'CONFIRMED', 'RELOCATED', 'CANCELLED');
CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  table_assignment_ids uuid[] NOT NULL DEFAULT '{}',
  status reservation_status NOT NULL DEFAULT 'PENDING',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_event_idx ON reservations(event_id);
