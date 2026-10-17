-- Provisioning and push delivery state. Matching never performs venue side effects.
ALTER TABLE dining_tables ADD COLUMN provision_status text NOT NULL DEFAULT 'PENDING' CHECK (provision_status IN ('PENDING','PROVISIONED','EXCEPTION'));
ALTER TABLE dining_tables ADD COLUMN provision_attempts integer NOT NULL DEFAULT 0;
CREATE TABLE push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','DISABLED')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(job_id,subscription_id)
);