-- Private staging only; no privilege to create/modify administrative receipts.
GRANT SELECT ON master_wok_event_test.cutover_response_routes TO master_wok_event_writer_login;
CREATE POLICY cutover_response_route_reader ON master_wok_event_test.cutover_response_routes FOR SELECT TO master_wok_event_writer_login USING(true);
GRANT EXECUTE ON FUNCTION master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text) TO master_wok_event_writer_login;
