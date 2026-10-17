-- A participant can have one attendance row per application and selected event.
CREATE UNIQUE INDEX attendance_application_event_unique ON attendance_records(application_id,event_id);
