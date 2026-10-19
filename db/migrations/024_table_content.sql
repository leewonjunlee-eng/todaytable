CREATE TABLE table_content_templates (
 id uuid PRIMARY KEY, title text NOT NULL, atmosphere text NOT NULL DEFAULT 'ANY' CHECK(atmosphere IN ('ANY','BALANCED','LIVELY','CALM')),
 interest_tags jsonb NOT NULL DEFAULT '[]', topics jsonb NOT NULL, game text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, priority integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX table_content_rule_idx ON table_content_templates(enabled,priority);
