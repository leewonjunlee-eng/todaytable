-- Notifications / announcements (Step C) — PostgreSQL production
CREATE TYPE notification_channel AS ENUM ('IN_APP', 'EMAIL', 'PUSH');
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  recipient_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL,
  channel notification_channel NOT NULL DEFAULT 'IN_APP',
  status text NOT NULL DEFAULT 'SENT' CHECK(status IN ('PENDING','SENT','FAILED')),
  sent_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_event_idx ON notifications(event_id);
CREATE INDEX notifications_user_idx ON notifications(recipient_user_id);
