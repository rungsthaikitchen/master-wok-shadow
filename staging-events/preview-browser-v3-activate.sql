-- Candidate only: apply after privilege snapshot and private connection setup.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT FROM master_wok_event_test.streams WHERE enabled) OR NOT EXISTS(
  SELECT FROM master_wok_event_test.command_routes r JOIN master_wok_event_test.streams s ON s.id=r.current_stream
  WHERE r.id='97f09d20-db85-5f05-ad93-2087d9f2501e' AND r.generation=0 AND s.id='4cbf42dd-4829-5216-b91c-ac4e0d907191' AND NOT s.enabled AND s.event_count=2 AND s.service_date='2026-10-29' AND s.scope='SYNTHETIC_STAGING_EVENTS'
 ) OR EXISTS(SELECT FROM master_wok_event_test.staff_commands WHERE route_id='97f09d20-db85-5f05-ad93-2087d9f2501e') THEN RAISE EXCEPTION 'PREVIEW_FRESH_FIXTURE_REQUIRED'; END IF;
END $$;
GRANT SELECT ON master_wok_event_test.command_routes TO master_wok_event_writer_login;
GRANT SELECT(id,current_stream,generation) ON master_wok_event_test.command_routes TO master_wok_event_reader_login;
GRANT SELECT(stream_id,id,order_alias,status,preferred_time,proposed_time,confirmed_time) ON master_wok_event_test.booking_rows TO master_wok_event_reader_login;
CREATE POLICY preview_browser_v3_reader ON master_wok_event_test.booking_rows FOR SELECT TO master_wok_event_reader_login USING(stream_id='4cbf42dd-4829-5216-b91c-ac4e0d907191');
GRANT SELECT ON master_wok_event_test.staff_commands TO master_wok_event_reader_login,master_wok_event_writer_login;
GRANT INSERT ON master_wok_event_test.staff_commands TO master_wok_event_writer_login;
CREATE POLICY preview_browser_v3_audit_read ON master_wok_event_test.staff_commands FOR SELECT TO master_wok_event_reader_login,master_wok_event_writer_login USING(route_id='97f09d20-db85-5f05-ad93-2087d9f2501e');
CREATE POLICY preview_browser_v3_audit_insert ON master_wok_event_test.staff_commands FOR INSERT TO master_wok_event_writer_login WITH CHECK(route_id='97f09d20-db85-5f05-ad93-2087d9f2501e');
GRANT EXECUTE ON FUNCTION master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid),master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz) TO master_wok_event_writer_login;
UPDATE master_wok_event_test.streams SET enabled=true WHERE id='4cbf42dd-4829-5216-b91c-ac4e0d907191';
COMMIT;
