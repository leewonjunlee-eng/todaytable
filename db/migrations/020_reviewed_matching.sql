-- Availability registration and operator-reviewed matching. Existing confirmed tables are preserved.
CREATE TABLE availability_slots (
 id TEXT PRIMARY KEY, day TEXT NOT NULL, area TEXT NOT NULL,
 event_id uuid NOT NULL UNIQUE REFERENCES events(id), UNIQUE(day,area)
);
CREATE TABLE availability_registrations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 application_id uuid UNIQUE REFERENCES applications(id), dates TEXT NOT NULL, areas TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX availability_user_idx ON availability_registrations(user_id,created_at);
CREATE TABLE venue_profiles (
 venue_id uuid PRIMARY KEY REFERENCES venues(id), cuisine TEXT NOT NULL DEFAULT '다이닝',
 description TEXT NOT NULL DEFAULT '', atmosphere TEXT NOT NULL DEFAULT '[]', interest_tags TEXT NOT NULL DEFAULT '[]',
 price_min INTEGER NOT NULL DEFAULT 20000, price_max INTEGER NOT NULL DEFAULT 30000,
 dietary_support TEXT NOT NULL DEFAULT '[]', CHECK(price_min>=0 AND price_max>=price_min)
);
CREATE TABLE venue_public_reviews (
 id uuid PRIMARY KEY, venue_id uuid NOT NULL REFERENCES venues(id), author_user_id uuid NOT NULL REFERENCES users(id),
 table_id uuid REFERENCES dining_tables(id), feedback_id uuid UNIQUE REFERENCES journey_feedback(id) ON DELETE CASCADE,
 score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), body TEXT NOT NULL,
 is_demo boolean NOT NULL DEFAULT FALSE, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX venue_public_reviews_idx ON venue_public_reviews(venue_id,created_at);
CREATE TABLE matching_proposals (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id), match_run_id uuid NOT NULL REFERENCES match_runs(id),
 source_table_id uuid REFERENCES dining_tables(id), confirmed_table_id uuid REFERENCES dining_tables(id),
 fingerprint TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','HELD','APPROVED','REJECTED','STALE')),
 policy_snapshot TEXT NOT NULL, candidates TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '[]', explanation TEXT NOT NULL,
 venue_id uuid REFERENCES venues(id), venue_reason TEXT NOT NULL DEFAULT '', quality_score REAL NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 0, review_note TEXT NOT NULL DEFAULT '',
 reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX matching_review_queue_idx ON matching_proposals(status,created_at);
CREATE TABLE matching_proposal_members (
 proposal_id uuid NOT NULL REFERENCES matching_proposals(id) ON DELETE CASCADE,
 application_id uuid NOT NULL REFERENCES applications(id), user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(proposal_id,application_id)
);
CREATE INDEX matching_proposal_app_idx ON matching_proposal_members(application_id);
CREATE TABLE matching_decisions (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL REFERENCES matching_proposals(id), actor_id uuid NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', from_version INTEGER NOT NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
