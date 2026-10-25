-- Temporary private staging grants; no quote issuance or route control rights.
GRANT SELECT ON master_wok_event_test.command_routes TO master_wok_event_writer_login;
GRANT SELECT ON master_wok_event_test.checkout_quotes TO master_wok_event_writer_login;
GRANT SELECT,INSERT ON master_wok_event_test.checkout_submissions TO master_wok_event_writer_login;
CREATE POLICY checkout_quote_writer_read ON master_wok_event_test.checkout_quotes FOR SELECT TO master_wok_event_writer_login USING(EXISTS(SELECT FROM master_wok_event_test.command_routes r WHERE r.id=route_id AND r.scope='SYNTHETIC_STAGING_EVENTS'));
CREATE POLICY checkout_submission_writer_read ON master_wok_event_test.checkout_submissions FOR SELECT TO master_wok_event_writer_login USING(EXISTS(SELECT FROM master_wok_event_test.command_routes r WHERE r.id=route_id AND r.scope='SYNTHETIC_STAGING_EVENTS'));
CREATE POLICY checkout_submission_writer_insert ON master_wok_event_test.checkout_submissions FOR INSERT TO master_wok_event_writer_login WITH CHECK(EXISTS(SELECT FROM master_wok_event_test.command_routes r WHERE r.id=route_id AND r.scope='SYNTHETIC_STAGING_EVENTS'));
GRANT EXECUTE ON FUNCTION master_wok_event_test.submit_checkout(uuid,text,uuid,uuid,jsonb) TO master_wok_event_writer_login;
