-- Private staging role proposal. No direct route writes or switch execution.
GRANT SELECT ON master_wok_event_test.command_routes TO master_wok_event_reader_login,master_wok_event_writer_login;
CREATE POLICY command_route_reader ON master_wok_event_test.command_routes FOR SELECT TO master_wok_event_reader_login,master_wok_event_writer_login USING(scope='SYNTHETIC_STAGING_EVENTS');
GRANT SELECT ON master_wok_event_test.cutover_response_routes TO master_wok_event_reader_login,master_wok_event_writer_login;
CREATE POLICY command_route_attestation_reader ON master_wok_event_test.cutover_response_routes FOR SELECT TO master_wok_event_reader_login USING(true);
GRANT EXECUTE ON FUNCTION master_wok_event_test.export_command_route(uuid) TO master_wok_event_reader_login;
GRANT EXECUTE ON FUNCTION master_wok_event_test.routed_create_booking(uuid,text,uuid,text,timestamptz,jsonb),master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid),master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text) TO master_wok_event_writer_login;
