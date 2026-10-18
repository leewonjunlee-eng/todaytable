ALTER TABLE support_messages ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0;
CREATE INDEX support_message_order_idx ON support_messages(ticket_id,ordinal);
