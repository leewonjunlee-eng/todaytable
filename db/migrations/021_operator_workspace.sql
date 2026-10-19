-- Distinguish automatic confirmation and track each table's restaurant booking separately.
ALTER TABLE matching_proposals ADD COLUMN dietary_verified boolean NOT NULL DEFAULT FALSE;
ALTER TABLE dining_tables ADD COLUMN confirmation_source TEXT NOT NULL DEFAULT 'LEGACY' CHECK(confirmation_source IN ('LEGACY','AUTO','OPERATOR'));
ALTER TABLE venue_profiles ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE venue_profiles ADD COLUMN booking_url TEXT NOT NULL DEFAULT '';
CREATE TABLE venue_booking_tasks (
 table_id uuid PRIMARY KEY REFERENCES dining_tables(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'TO_BOOK' CHECK(status IN ('TO_BOOK','REQUESTED','CONFIRMED','CHANGE_NEEDED','CANCELLED')),
 reservation_name TEXT NOT NULL DEFAULT '', confirmation_code TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 assigned_to uuid REFERENCES users(id), updated_by uuid REFERENCES users(id), version INTEGER NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX venue_booking_status_idx ON venue_booking_tasks(status,updated_at);
INSERT INTO venue_booking_tasks(table_id,reservation_name) SELECT t.id,COALESCE(r.reservation_name,'우연한 식탁') FROM dining_tables t LEFT JOIN table_reservations r ON r.table_id=t.id WHERE t.status='CONFIRMED';
