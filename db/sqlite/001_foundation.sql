CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PARTICIPANT' CHECK(role IN ('PARTICIPANT','ADMIN')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL, contact_phone TEXT NOT NULL,
  birth_year INTEGER NOT NULL CHECK(birth_year BETWEEN 1900 AND 9999),
  gender TEXT NOT NULL CHECK(gender IN ('WOMAN','MAN','NON_BINARY','PREFER_NOT_TO_SAY')),
  occupation TEXT NOT NULL DEFAULT '', mbti TEXT NOT NULL CHECK(length(mbti)=4),
  interests TEXT NOT NULL DEFAULT '[]', traits TEXT NOT NULL DEFAULT '[]',
  desired_traits TEXT NOT NULL DEFAULT '[]', food_budgets TEXT NOT NULL DEFAULT '[]',
  dietary_notes TEXT NOT NULL DEFAULT '', consent_privacy INTEGER NOT NULL DEFAULT 0,
  consent_operations INTEGER NOT NULL DEFAULT 0, consent_version TEXT NOT NULL DEFAULT 'v1',
  consented_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))), title TEXT NOT NULL,
  starts_at TEXT NOT NULL, application_deadline TEXT NOT NULL, area TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 30 CHECK(capacity > 0), price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','CANCELLED')),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE venues (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))), name TEXT NOT NULL, area TEXT NOT NULL,
  address TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity > 0), active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE applications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))), user_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK(status IN ('DRAFT','SUBMITTED','CANCELED')),
  matching_status TEXT NOT NULL DEFAULT 'WAITING'
    CHECK(matching_status IN ('WAITING','MATCHING','REALLOCATING','CONFIRMED','ALTERNATIVE_OFFERED','TRANSFERRED','NO_MATCH','EXCEPTION')),
  pass_choice TEXT NOT NULL CHECK(pass_choice IN ('SINGLE','THREE_PASS','EXISTING_PASS')),
  pass_uses INTEGER NOT NULL CHECK(pass_uses BETWEEN 1 AND 3), amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,request_key)
);
CREATE INDEX applications_user_idx ON applications(user_id,created_at DESC);
CREATE TABLE application_options (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id), PRIMARY KEY(application_id,event_id)
);
CREATE TABLE payments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))), application_id TEXT NOT NULL UNIQUE REFERENCES applications(id),
  idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','PAID','FAILED','REFUND_AVAILABLE','REFUND_REQUESTED','REFUND_PROCESSING','REFUNDED','REFUND_FAILED')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), provider TEXT NOT NULL DEFAULT 'MOCK',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE entitlements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))), user_id TEXT NOT NULL REFERENCES users(id),
  source_payment_id TEXT UNIQUE REFERENCES payments(id), original_uses INTEGER NOT NULL CHECK(original_uses>0),
  remaining_uses INTEGER NOT NULL CHECK(remaining_uses>=0 AND remaining_uses<=original_uses),
  expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE entitlement_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entitlement_id TEXT NOT NULL REFERENCES entitlements(id),
  application_id TEXT NOT NULL REFERENCES applications(id), entry_type TEXT NOT NULL CHECK(entry_type IN ('USE','RESTORE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(entitlement_id,application_id,entry_type)
);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_data TEXT, after_data TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE scheduled_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))), job_key TEXT NOT NULL UNIQUE, job_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}', run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 8,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, lease_owner TEXT, lease_until TEXT,
  last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE TABLE job_effects (
  job_id TEXT PRIMARY KEY REFERENCES scheduled_jobs(id), effect_type TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX scheduled_jobs_claim_idx ON scheduled_jobs(status,next_attempt_at,run_at);
