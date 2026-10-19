CREATE TABLE payment_attempts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL UNIQUE,
 application_id TEXT REFERENCES applications(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 outcome TEXT NOT NULL CHECK(outcome IN ('SUCCEEDED','FAILED','CANCELED')), selection TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payment_ledger (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id), request_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('CHARGE','REFUND')), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 source TEXT NOT NULL DEFAULT 'VIRTUAL', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents,source)
 SELECT id,id,'legacy-charge:'||id,'CHARGE',amount_cents,'LEGACY' FROM payments WHERE status IN ('PAID','REFUND_AVAILABLE','REFUND_REQUESTED','REFUND_PROCESSING','REFUNDED','REFUND_FAILED');
INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents,source)
 SELECT 'refund-'||id,id,'legacy-refund:'||id,'REFUND',amount_cents,'LEGACY' FROM payments WHERE status='REFUNDED';
CREATE INDEX payment_attempts_user_idx ON payment_attempts(user_id,created_at);
CREATE INDEX payment_ledger_payment_idx ON payment_ledger(payment_id,created_at);
