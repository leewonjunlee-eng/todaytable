CREATE TABLE source_data_datasets (
  sha256 TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  manifest TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE source_data_responses (
  dataset_sha256 TEXT NOT NULL REFERENCES source_data_datasets(sha256),
  sheet_name TEXT NOT NULL,
  sheet_row INTEGER NOT NULL CHECK(sheet_row > 2),
  raw_values TEXT NOT NULL,
  fields TEXT NOT NULL,
  issues TEXT NOT NULL,
  PRIMARY KEY(dataset_sha256, sheet_name, sheet_row)
);
CREATE TABLE source_demo_conversions (
  dataset_sha256 TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  sheet_row INTEGER NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  application_id TEXT NOT NULL UNIQUE REFERENCES applications(id),
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  assumptions TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(dataset_sha256, sheet_name, sheet_row)
);
