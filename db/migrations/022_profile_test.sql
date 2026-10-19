CREATE TABLE profile_tests (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 test_version text NOT NULL,
 answers jsonb NOT NULL,
 result_title text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
