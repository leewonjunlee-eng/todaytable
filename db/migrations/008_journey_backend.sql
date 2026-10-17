-- Journey backend: rooms, messages, private feedback, safety, reservations, push, and persisted rules.
CREATE TABLE journey_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL UNIQUE REFERENCES dining_tables(id) ON DELETE CASCADE,
  welcome_message text NOT NULL, rules_message text NOT NULL, curation_message text NOT NULL,
  topics jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE journey_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES journey_rooms(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  request_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(room_id,request_key)
);
CREATE INDEX journey_messages_room_idx ON journey_messages(room_id,created_at,id);
CREATE TABLE journey_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, table_score integer NOT NULL CHECK(table_score BETWEEN 1 AND 5),
  conversation_score integer NOT NULL CHECK(conversation_score BETWEEN 1 AND 5), venue_score integer NOT NULL CHECK(venue_score BETWEEN 1 AND 5),
  return_intent boolean NOT NULL, recommend_intent boolean NOT NULL, comment text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(table_id,author_user_id)
);
CREATE TABLE safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000), decision text NOT NULL DEFAULT 'OPEN' CHECK(decision IN ('OPEN','DISMISSED','WARNING','SUSPEND','PERMANENT')),
  note text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewed_by uuid REFERENCES users(id), UNIQUE(table_id,reporter_user_id,target_user_id)
);
CREATE TABLE feedback_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  source_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK(relationship_type IN ('LIKE','DISLIKE')), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(table_id,source_user_id,target_user_id)
);
CREATE TABLE table_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL UNIQUE REFERENCES dining_tables(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id), reservation_name text NOT NULL, meeting_time timestamptz NOT NULL, status text NOT NULL DEFAULT 'CONFIRMED',
  provider text NOT NULL DEFAULT 'MOCK', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE, subscription jsonb NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE matching_rules (
  id integer PRIMARY KEY DEFAULT 1, version text NOT NULL, min_score numeric NOT NULL DEFAULT 0,
  weights jsonb NOT NULL DEFAULT '{"gender":0.4,"mbti":0.25,"interests":0.2,"traits":0.1,"novelty":0.05}', updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO matching_rules(id,version) VALUES(1,'core-v1') ON CONFLICT(id) DO NOTHING;
ALTER TABLE events ADD COLUMN venue_id uuid REFERENCES venues(id);
ALTER TABLE dining_tables ADD COLUMN venue_id uuid REFERENCES venues(id);
ALTER TABLE dining_tables ADD COLUMN starts_at timestamptz;
ALTER TABLE dining_tables ADD COLUMN area text;
ALTER TABLE dining_tables ADD COLUMN capacity integer;
ALTER TABLE dining_tables ADD COLUMN locked_at timestamptz;
ALTER TABLE attendance_records ADD COLUMN checked_in_at timestamptz;
ALTER TABLE attendance_records ADD COLUMN feedback_requested_at timestamptz;
ALTER TABLE attendance_records ADD COLUMN followup_sent_at timestamptz;
