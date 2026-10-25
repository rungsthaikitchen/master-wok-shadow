-- Fresh synthetic staging pair; all fixtures disabled at commit. Conflicts fail.
BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL TIME ZONE 'UTC';
DO $fixture$
DECLARE src uuid:='03f8a64f-049c-5613-bc70-93e5b88ed9ab'; dst uuid:='74247071-2b40-52cc-8b7b-dfd260a5b7cd'; booking uuid:='2171bf9b-de7f-5978-a729-b5ace65a3adb';
BEGIN
 IF clock_timestamp()>='2026-10-26T19:00:00Z'::timestamptz THEN RAISE EXCEPTION 'FIXTURES_EXPIRED'; END IF;
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES(src,'2026-10-26',true),(dst,'2026-10-26',true);
 PERFORM master_wok_event_test.create_booking(src,'cutover-http-create',booking,'synthetic-cutover-http','2026-10-26T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.apply_booking(src,'offer-a',booking,'offer','2026-10-26T19:00:00Z',NULL);
 PERFORM master_wok_event_test.seed_cutover_baseline(src,dst,'cutover-http-baseline');
 ASSERT master_wok_event_test.authorize_cutover_response_route(src,dst,'cutover-http-baseline')='RECORDED';
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id IN (src,dst);
 ASSERT (SELECT count(*)=2 FROM master_wok_event_test.streams WHERE id IN (src,dst) AND NOT enabled);
END $fixture$;
COMMIT;
