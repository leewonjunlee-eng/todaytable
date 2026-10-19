CREATE TABLE waitlist_offers (
 id TEXT PRIMARY KEY,table_id TEXT NOT NULL REFERENCES dining_tables(id),application_id TEXT NOT NULL REFERENCES applications(id),
 status TEXT NOT NULL DEFAULT 'OFFERED' CHECK(status IN ('OFFERED','ACCEPTED','DECLINED','EXPIRED','UNAVAILABLE')),
 expires_at TEXT NOT NULL,responded_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(table_id,application_id)
);
CREATE INDEX waitlist_offer_due ON waitlist_offers(status,expires_at);
