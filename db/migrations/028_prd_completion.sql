ALTER TABLE events ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE venue_slots (
 id UUID PRIMARY KEY, venue_id UUID NOT NULL REFERENCES venues(id), starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 seats INTEGER NOT NULL CHECK(seats>=0), table_limit INTEGER NOT NULL CHECK(table_limit>=0),
 closed BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 0,
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(ends_at>starts_at)
);
CREATE INDEX venue_slots_time ON venue_slots(venue_id,starts_at,ends_at);
CREATE TABLE venue_dietary_checks (
 id UUID PRIMARY KEY, venue_id UUID NOT NULL REFERENCES venues(id), user_id UUID NOT NULL REFERENCES users(id),
 notes TEXT NOT NULL, valid_until TIMESTAMPTZ NOT NULL, confirmed_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE notification_templates (
 id UUID PRIMARY KEY, kind TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
 active BOOLEAN NOT NULL DEFAULT true, created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(kind,version)
);
CREATE UNIQUE INDEX notification_template_active ON notification_templates(kind) WHERE active=true;
CREATE TABLE business_events (
 id UUID PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, user_id UUID NOT NULL REFERENCES users(id),
 application_id UUID REFERENCES applications(id), event_id UUID REFERENCES events(id),
 variables JSONB NOT NULL DEFAULT '{}'::jsonb, template_id UUID REFERENCES notification_templates(id),
 message TEXT NOT NULL, action_url TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 delivered_at TIMESTAMPTZ
);
CREATE TABLE reallocation_events (
 id UUID PRIMARY KEY, application_id UUID NOT NULL REFERENCES applications(id), run_id UUID REFERENCES match_runs(id),
 source_event_id UUID REFERENCES events(id), target_event_id UUID REFERENCES events(id),
 phase TEXT NOT NULL CHECK(phase IN ('INITIAL','REPAIR')), status TEXT NOT NULL CHECK(status IN ('SEARCHING','CONFIRMED','FAILED')),
 priority INTEGER, reason TEXT NOT NULL, actor_user_id UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX reallocation_application ON reallocation_events(application_id,created_at);
CREATE TABLE deletion_requests (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
 status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','HELD','PROCESSING','COMPLETED')),
 version INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', result JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMPTZ, processed_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX deletion_one_open ON deletion_requests(user_id) WHERE status<>'COMPLETED';
CREATE TABLE checkout_sessions (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), selection TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','FAILED','CANCELED','COMPLETED','EXPIRED')),
 expires_at TIMESTAMPTZ NOT NULL, application_id UUID REFERENCES applications(id), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE refund_requests ADD COLUMN completion_source TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE profiles ADD COLUMN recruitment_alerts BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE venues ADD COLUMN schedule_required BOOLEAN NOT NULL DEFAULT false;
