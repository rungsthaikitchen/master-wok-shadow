BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL TIME ZONE 'UTC';
DO $test$
DECLARE src uuid:=gen_random_uuid(); dst uuid:=gen_random_uuid(); o uuid:=gen_random_uuid();
 day date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date+1;
BEGIN
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES(src,day,true),(dst,day,true);
 PERFORM master_wok_event_test.create_booking(src,'hosted-cutover-create',o,'synthetic-hosted-cutover',day+time '18:00','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.apply_booking(src,'hosted-current-offer',o,'offer',day+time '19:00',NULL);
 PERFORM master_wok_event_test.seed_cutover_baseline(src,dst,'hosted-cutover-baseline');
 PERFORM pg_sleep(0.01);
 PERFORM master_wok_event_test.apply_booking(dst,'hosted-accept-offer',o,'accept',NULL,'hosted-current-offer');
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id=dst);
 ASSERT (SELECT commitment='CONFIRMED' FROM master_wok_event_test.reservations WHERE stream_id=dst);
 PERFORM master_wok_event_test.apply_booking(dst,'hosted-replacement-offer',o,'offer',day+time '19:30',NULL);
 BEGIN
  PERFORM master_wok_event_test.apply_booking(dst,'hosted-stale-accept',o,'accept',NULL,'hosted-current-offer');
  RAISE EXCEPTION 'STALE_RESPONSE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STALE_PROPOSAL_RESPONSE' THEN RAISE; END IF; END;
 PERFORM master_wok_event_test.apply_booking(dst,'hosted-reject-replacement',o,'reject',NULL,'hosted-replacement-offer');
 PERFORM master_wok_event_test.apply_booking(dst,'hosted-complete-unreserved',o,'complete',NULL,NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.reservations WHERE stream_id=dst);
 ASSERT master_wok_event_test.seed_cutover_baseline(src,dst,'hosted-cutover-baseline')='ALREADY_RECORDED';
 ASSERT (SELECT event_count=5 FROM master_wok_event_test.streams WHERE id=dst);
 PERFORM set_config('master_wok_trial.lifecycle_export',master_wok_event_test.export(dst)::text,true);
END $test$;
SELECT true AS lifecycle_checks_passed,current_setting('master_wok_trial.lifecycle_export')::jsonb AS batch;
ROLLBACK;
