-- Private synthetic staging only. Existing reader/writer roles; no credentials.
GRANT SELECT,INSERT ON master_wok_event_test.booking_transfers TO master_wok_event_writer_login;
GRANT SELECT ON master_wok_event_test.booking_transfers TO master_wok_event_reader_login;
CREATE POLICY transfer_writer_select ON master_wok_event_test.booking_transfers FOR SELECT TO master_wok_event_writer_login
 USING((SELECT count(*) FROM master_wok_event_test.streams s WHERE s.id IN (source_stream,destination_stream) AND s.enabled AND s.scope='SYNTHETIC_STAGING_EVENTS')=2);
CREATE POLICY transfer_writer_insert ON master_wok_event_test.booking_transfers FOR INSERT TO master_wok_event_writer_login
 WITH CHECK((SELECT count(*) FROM master_wok_event_test.streams s WHERE s.id IN (source_stream,destination_stream) AND s.enabled AND s.scope='SYNTHETIC_STAGING_EVENTS')=2);
-- SELECT includes disabled counterpart receipts: closure checks must not hide third-stream history.
CREATE POLICY transfer_reader_select ON master_wok_event_test.booking_transfers FOR SELECT TO master_wok_event_reader_login
 USING((SELECT count(*) FROM master_wok_event_test.streams s WHERE s.id IN (source_stream,destination_stream) AND s.scope='SYNTHETIC_STAGING_EVENTS')=2);
GRANT EXECUTE ON FUNCTION master_wok_event_test.move_booking_offer(uuid,uuid,text,uuid,timestamptz) TO master_wok_event_writer_login;
GRANT EXECUTE ON FUNCTION master_wok_event_test.export_transfer_pair(uuid,uuid) TO master_wok_event_reader_login;
