CREATE TABLE waitlist_offers (
 id UUID PRIMARY KEY,table_id UUID NOT NULL REFERENCES dining_tables(id),application_id UUID NOT NULL REFERENCES applications(id),
 status TEXT NOT NULL DEFAULT 'OFFERED' CHECK(status IN ('OFFERED','ACCEPTED','DECLINED','EXPIRED','UNAVAILABLE')),
 expires_at TIMESTAMPTZ NOT NULL,responded_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(table_id,application_id)
);
CREATE INDEX waitlist_offer_due ON waitlist_offers(status,expires_at);
