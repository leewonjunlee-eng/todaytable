-- Source preservation, separate from live user identities and application state.
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
