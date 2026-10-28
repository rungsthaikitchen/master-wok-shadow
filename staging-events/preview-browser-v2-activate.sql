-- Candidate only: apply after privilege snapshot and private connection setup.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT FROM master_wok_event_test.streams WHERE enabled) OR NOT EXISTS(
  SELECT FROM master_wok_event_test.command_routes r JOIN master_wok_event_test.streams s ON s.id=r.current_stream
  WHERE r.id='3d31312d-cb9b-53d0-b69b-801b5bbc5698' AND r.generation=0 AND s.id='795f3b0b-08e0-5d22-8071-a97e9cd52912' AND NOT s.enabled AND s.event_count=2 AND s.service_date='2026-10-28' AND s.scope='SYNTHETIC_STAGING_EVENTS'
 ) OR EXISTS(SELECT FROM master_wok_event_test.staff_commands WHERE route_id='3d31312d-cb9b-53d0-b69b-801b5bbc5698') THEN RAISE EXCEPTION 'PREVIEW_FRESH_FIXTURE_REQUIRED'; END IF;
END $$;
GRANT SELECT ON master_wok_event_test.command_routes TO master_wok_event_writer_login;
GRANT SELECT(id,current_stream,generation) ON master_wok_event_test.command_routes TO master_wok_event_reader_login;
GRANT SELECT(stream_id,id,order_alias,status,preferred_time,proposed_time,confirmed_time) ON master_wok_event_test.booking_rows TO master_wok_event_reader_login;
CREATE POLICY preview_browser_v2_reader ON master_wok_event_test.booking_rows FOR SELECT TO master_wok_event_reader_login USING(stream_id='795f3b0b-08e0-5d22-8071-a97e9cd52912');
GRANT SELECT ON master_wok_event_test.staff_commands TO master_wok_event_reader_login,master_wok_event_writer_login;
GRANT INSERT ON master_wok_event_test.staff_commands TO master_wok_event_writer_login;
CREATE POLICY preview_browser_v2_audit_read ON master_wok_event_test.staff_commands FOR SELECT TO master_wok_event_reader_login,master_wok_event_writer_login USING(route_id='3d31312d-cb9b-53d0-b69b-801b5bbc5698');
CREATE POLICY preview_browser_v2_audit_insert ON master_wok_event_test.staff_commands FOR INSERT TO master_wok_event_writer_login WITH CHECK(route_id='3d31312d-cb9b-53d0-b69b-801b5bbc5698');
GRANT EXECUTE ON FUNCTION master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid),master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz) TO master_wok_event_writer_login;
UPDATE master_wok_event_test.streams SET enabled=true WHERE id='795f3b0b-08e0-5d22-8071-a97e9cd52912';
COMMIT;
