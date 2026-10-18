ALTER TABLE participant_preferences ADD COLUMN learning_enabled boolean NOT NULL DEFAULT TRUE;
CREATE INDEX feedback_author_idx ON journey_feedback(author_user_id,table_id);
