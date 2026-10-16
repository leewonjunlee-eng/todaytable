CREATE TYPE user_role AS ENUM ('PARTICIPANT','ADMIN');
CREATE TYPE application_status AS ENUM ('DRAFT','SUBMITTED','CANCELED');
CREATE TYPE matching_status AS ENUM ('WAITING','MATCHING','REALLOCATING','CONFIRMED','ALTERNATIVE_OFFERED','TRANSFERRED','NO_MATCH','EXCEPTION');
CREATE TYPE payment_status AS ENUM ('PENDING','PAID','FAILED','REFUND_AVAILABLE','REFUND_REQUESTED','REFUND_PROCESSING','REFUNDED','REFUND_FAILED');
CREATE TYPE attendance_status AS ENUM ('SCHEDULED','ATTENDED','CANCELED_EARLY','CANCELED_LATE','NO_SHOW');
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, role user_role NOT NULL DEFAULT 'PARTICIPANT',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL, contact_phone text NOT NULL, birth_year smallint NOT NULL CHECK(birth_year BETWEEN 1900 AND 9999),
  gender text NOT NULL CHECK (gender IN ('WOMAN','MAN','NON_BINARY','PREFER_NOT_TO_SAY')),
  occupation text NOT NULL DEFAULT '', mbti text NOT NULL CHECK (mbti ~ '^(I|E)(N|S)(F|T)(J|P)$'),
  interests text[] NOT NULL DEFAULT '{}', traits text[] NOT NULL DEFAULT '{}',
  desired_traits text[] NOT NULL DEFAULT '{}', food_budgets text[] NOT NULL DEFAULT '{}',
  dietary_notes text NOT NULL DEFAULT '', consent_privacy boolean NOT NULL DEFAULT false,
  consent_operations boolean NOT NULL DEFAULT false, consent_version text NOT NULL DEFAULT 'v1',
  consented_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL,
  starts_at timestamptz NOT NULL, application_deadline timestamptz NOT NULL,
  area text NOT NULL, capacity integer NOT NULL DEFAULT 30 CHECK(capacity > 0),
  price_cents integer NOT NULL CHECK(price_cents >= 0), status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','CANCELLED')),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, area text NOT NULL,
  address text NOT NULL, capacity integer NOT NULL CHECK(capacity > 0),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), request_key uuid NOT NULL,
  status application_status NOT NULL DEFAULT 'SUBMITTED', matching_status matching_status NOT NULL DEFAULT 'WAITING',
  pass_choice text NOT NULL CHECK(pass_choice IN ('SINGLE','THREE_PASS','EXISTING_PASS')),
  pass_uses smallint NOT NULL CHECK(pass_uses BETWEEN 1 AND 3),
  amount_cents integer NOT NULL CHECK(amount_cents >= 0), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key)
);
CREATE INDEX applications_user_idx ON applications(user_id,created_at DESC);
CREATE TABLE application_options (
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id), PRIMARY KEY(application_id,event_id)
);
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL UNIQUE REFERENCES applications(id),
  idempotency_key text NOT NULL UNIQUE, status payment_status NOT NULL DEFAULT 'PENDING',
  amount_cents integer NOT NULL CHECK(amount_cents >= 0), provider text NOT NULL DEFAULT 'MOCK',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  source_payment_id uuid UNIQUE REFERENCES payments(id), original_uses smallint NOT NULL CHECK(original_uses>0),
  remaining_uses smallint NOT NULL CHECK(remaining_uses>=0 AND remaining_uses<=original_uses),
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entitlement_entries (
  id bigserial PRIMARY KEY, entitlement_id uuid NOT NULL REFERENCES entitlements(id),
  application_id uuid NOT NULL REFERENCES applications(id), entry_type text NOT NULL CHECK(entry_type IN ('USE','RESTORE')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(entitlement_id,application_id,entry_type)
);
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY, actor_user_id uuid REFERENCES users(id), action text NOT NULL,
  entity_type text NOT NULL, entity_id text NOT NULL, before_data jsonb, after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_key text NOT NULL UNIQUE,
  job_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','DEAD')),
  attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_owner text, lease_until timestamptz,
  last_error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE job_effects (job_id uuid PRIMARY KEY REFERENCES scheduled_jobs(id), effect_type text NOT NULL, completed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX scheduled_jobs_claim_idx ON scheduled_jobs(status,next_attempt_at,run_at);
