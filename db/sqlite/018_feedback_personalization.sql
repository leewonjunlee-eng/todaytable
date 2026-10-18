ALTER TABLE participant_preferences ADD COLUMN learning_enabled INTEGER NOT NULL DEFAULT 1;
CREATE INDEX feedback_author_idx ON journey_feedback(author_user_id,table_id);
