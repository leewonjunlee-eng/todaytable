-- Product evolution: collaborative support, policy snapshots and learning provenance.
ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN is_demo INTEGER NOT NULL DEFAULT FALSE;
ALTER TABLE applications ADD COLUMN is_demo INTEGER NOT NULL DEFAULT FALSE;
ALTER TABLE journey_feedback ADD COLUMN is_demo INTEGER NOT NULL DEFAULT FALSE;
UPDATE users SET is_demo=TRUE WHERE email LIKE '%@demo.todaytable.invalid';
UPDATE events SET is_demo=TRUE WHERE title LIKE '[모의]%' OR title LIKE 'DEMO ONLY%';
UPDATE applications SET is_demo=TRUE WHERE id IN (SELECT o.application_id FROM application_options o JOIN events e ON e.id=o.event_id WHERE e.is_demo=TRUE);
UPDATE journey_feedback SET is_demo=TRUE WHERE table_id IN (SELECT t.id FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE e.is_demo=TRUE);
CREATE TABLE operator_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id), display_name TEXT NOT NULL,
 team_role TEXT NOT NULL CHECK(team_role IN ('OWNER','OPERATOR')), active INTEGER NOT NULL DEFAULT TRUE,
 avatar_color TEXT NOT NULL DEFAULT '#73563e', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE support_visitors (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE support_tickets (
 id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, user_id TEXT REFERENCES users(id), visitor_id TEXT REFERENCES support_visitors(id),
 contact_name TEXT NOT NULL, contact_email TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, category TEXT NOT NULL,
 tags TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED')),
 priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
 assignee_id TEXT REFERENCES operator_profiles(user_id), application_id TEXT REFERENCES applications(id), table_id TEXT REFERENCES dining_tables(id),
 version INTEGER NOT NULL DEFAULT 0, next_followup_at TEXT, helpful INTEGER, is_demo INTEGER NOT NULL DEFAULT FALSE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_public_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, first_response_at TEXT, resolved_at TEXT,
 CHECK(user_id IS NOT NULL OR visitor_id IS NOT NULL)
);
CREATE INDEX support_ticket_queue_idx ON support_tickets(status,assignee_id,updated_at);
CREATE INDEX support_ticket_user_idx ON support_tickets(user_id,visitor_id);
CREATE TABLE support_messages (
 id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 author_user_id TEXT REFERENCES users(id), author_name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('PUBLIC','INTERNAL')), body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
 request_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(ticket_id,request_key)
);
CREATE INDEX support_message_ticket_idx ON support_messages(ticket_id,created_at,id);
CREATE TABLE support_activity (
 id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 actor_user_id TEXT REFERENCES users(id), actor_name TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE support_reads (ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, actor_key TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(ticket_id,actor_key));
CREATE TABLE support_presence (ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES operator_profiles(user_id), composing INTEGER NOT NULL DEFAULT FALSE, expires_at TEXT NOT NULL, PRIMARY KEY(ticket_id,user_id));
CREATE TABLE support_templates (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL, updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE improvement_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PLANNED','DONE')), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE improvement_tickets (item_id TEXT NOT NULL REFERENCES improvement_items(id), ticket_id TEXT NOT NULL REFERENCES support_tickets(id), PRIMARY KEY(item_id,ticket_id));
CREATE TABLE matching_policies (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, weights TEXT NOT NULL, min_score REAL NOT NULL DEFAULT 0, learning_enabled INTEGER NOT NULL DEFAULT TRUE, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE matching_defaults (id INTEGER PRIMARY KEY CHECK(id=1), policy_id TEXT REFERENCES matching_policies(id), version INTEGER NOT NULL DEFAULT 0);
INSERT INTO matching_defaults(id) VALUES(1);
CREATE TABLE event_policies (event_id TEXT PRIMARY KEY REFERENCES events(id), policy_id TEXT NOT NULL REFERENCES matching_policies(id), preview_hash TEXT NOT NULL, applied_by TEXT NOT NULL REFERENCES users(id), applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE matching_previews (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), snapshot_hash TEXT NOT NULL, snapshot TEXT NOT NULL, results TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE participant_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), atmosphere TEXT NOT NULL DEFAULT 'BALANCED', interests TEXT NOT NULL DEFAULT '[]', confirmed INTEGER NOT NULL DEFAULT FALSE, source_feedback_id TEXT REFERENCES journey_feedback(id), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE feedback_details (feedback_id TEXT PRIMARY KEY REFERENCES journey_feedback(id) ON DELETE CASCADE, positives TEXT NOT NULL DEFAULT '[]', improvements TEXT NOT NULL DEFAULT '[]', good_text TEXT NOT NULL DEFAULT '', improve_text TEXT NOT NULL DEFAULT '', next_atmosphere TEXT NOT NULL DEFAULT 'BALANCED', next_interests TEXT NOT NULL DEFAULT '[]', preference_confirmed INTEGER NOT NULL DEFAULT FALSE, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE preference_signals (user_id TEXT PRIMARY KEY REFERENCES users(id), atmosphere TEXT NOT NULL, evidence_count INTEGER NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, interests TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_events (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), event_type TEXT NOT NULL, entity_id TEXT, is_demo INTEGER NOT NULL DEFAULT FALSE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
