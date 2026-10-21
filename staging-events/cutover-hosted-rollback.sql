BEGIN;
SET LOCAL statement_timeout='15s';
DO $test$
DECLARE src uuid:=gen_random_uuid(); dst uuid:=gen_random_uuid(); o uuid:=gen_random_uuid();
 day date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date+1; baseline jsonb;
BEGIN
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES(src,day,true),(dst,day,true);
 PERFORM master_wok_event_test.create_booking(src,'cutover-rollback-create',o,'synthetic-cutover-rollback',day+time '18:00','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.apply_booking(src,'cutover-rollback-offer',o,'offer',day+time '19:00',NULL);
 BEGIN
  PERFORM master_wok_event_test.seed_cutover_baseline(src,dst,'cutover-injected-failure');
  RAISE EXCEPTION 'INJECTED_AFTER_SEED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'INJECTED_AFTER_SEED' THEN RAISE; END IF; END;
 ASSERT (SELECT enabled FROM master_wok_event_test.streams WHERE id=src),'source retired on failed transaction';
 ASSERT (SELECT event_count=0 FROM master_wok_event_test.streams WHERE id=dst),'baseline survived failure';
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.booking_rows WHERE stream_id=dst),'projection survived failure';
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.booking_commands WHERE stream_id=dst),'receipts survived failure';
 ASSERT master_wok_event_test.seed_cutover_baseline(src,dst,'cutover-after-rollback')='RECORDED';
 baseline:=master_wok_event_test.export(dst);
 ASSERT baseline->'coverage'->>'basis'='CUTOVER_BASELINE_AND_EVENT_LOG';
 ASSERT baseline->'events'->0->'commitments'->0->>'proposalEventId'='cutover-rollback-offer';
 ASSERT master_wok_event_test.seed_cutover_baseline(src,dst,'cutover-after-rollback')='ALREADY_RECORDED';
 PERFORM set_config('master_wok_trial.rollback_export',baseline::text,true);
END $test$;
SELECT true AS rollback_checks_passed,current_setting('master_wok_trial.rollback_export')::jsonb AS batch;
ROLLBACK;
