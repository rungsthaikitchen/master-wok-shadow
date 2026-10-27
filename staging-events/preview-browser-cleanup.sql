-- Candidate only. Use only after confirming these grants were absent pre-trial.
BEGIN;
UPDATE master_wok_event_test.streams SET enabled=false WHERE id='2d6768d3-3e60-57c2-b9c4-0ce1ae0ebf31';
DROP POLICY IF EXISTS preview_browser_reader ON master_wok_event_test.booking_rows;
DROP POLICY IF EXISTS preview_browser_audit_read ON master_wok_event_test.staff_commands;
DROP POLICY IF EXISTS preview_browser_audit_insert ON master_wok_event_test.staff_commands;
REVOKE SELECT(stream_id,id,order_alias,status,preferred_time,proposed_time,confirmed_time) ON master_wok_event_test.booking_rows FROM master_wok_event_reader_login;
REVOKE SELECT ON master_wok_event_test.command_routes FROM master_wok_event_writer_login;
REVOKE ALL ON master_wok_event_test.staff_commands FROM master_wok_event_reader_login,master_wok_event_writer_login;
REVOKE EXECUTE ON FUNCTION master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid),master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz) FROM master_wok_event_writer_login;
COMMIT;
