-- Link explicit synthetic demo conversions to immutable source response keys.
-- IF NOT EXISTS preserves the source rows previously loaded by scripts/import_provided_data.mjs.
CREATE SCHEMA IF NOT EXISTS provided_data;
CREATE TABLE IF NOT EXISTS provided_data.datasets (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  filename text NOT NULL,
  original_file bytea NOT NULL,
  manifest jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provided_data.survey_responses (
  dataset_sha256 text NOT NULL REFERENCES provided_data.datasets(sha256),
  sheet_name text NOT NULL,
  sheet_row integer NOT NULL CHECK (sheet_row > 2),
  raw_values jsonb NOT NULL CHECK (jsonb_typeof(raw_values) = 'array'),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array'),
  PRIMARY KEY (dataset_sha256, sheet_name, sheet_row)
);
CREATE TABLE source_demo_conversions (
  dataset_sha256 text NOT NULL,
  sheet_name text NOT NULL,
  sheet_row integer NOT NULL,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  event_id uuid NOT NULL REFERENCES events(id),
  application_id uuid NOT NULL UNIQUE REFERENCES applications(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  assumptions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(dataset_sha256, sheet_name, sheet_row)
);
