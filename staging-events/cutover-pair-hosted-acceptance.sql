-- Private staging hvrqgufqjslvgiohgkvu only. All synthetic fixture writes roll back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL TIME ZONE 'UTC';
DO $test$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); na uuid:=gen_random_uuid(); nb uuid:=gen_random_uuid();
 travelling uuid:=gen_random_uuid(); staying uuid:=gen_random_uuid(); confirmed uuid:=gen_random_uuid(); declined uuid:=gen_random_uuid();
 day_a date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date+1; day_b date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date+2;
 lines jsonb:='[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]'; initial jsonb; final jsonb;
BEGIN
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES(a,day_a,true),(b,day_b,true),(na,day_a,true),(nb,day_b,true);
 PERFORM master_wok_event_test.create_booking(a,'hosted-pair-create-travelling',travelling,'synthetic-pair-travelling',day_a+time '18:00',lines);
 PERFORM master_wok_event_test.create_booking(a,'hosted-pair-create-staying',staying,'synthetic-pair-staying',day_a+time '18:00',lines);
 PERFORM master_wok_event_test.create_booking(b,'hosted-pair-create-confirmed',confirmed,'synthetic-pair-confirmed',day_b+time '18:00',lines);
 PERFORM master_wok_event_test.create_booking(b,'hosted-pair-create-declined',declined,'synthetic-pair-declined',day_b+time '18:00',lines);
 PERFORM master_wok_event_test.apply_booking(a,'hosted-pair-offer-staying',staying,'offer',day_a+time '19:00',NULL);
 PERFORM master_wok_event_test.apply_booking(b,'hosted-pair-confirm',confirmed,'confirm',NULL,NULL);
 PERFORM master_wok_event_test.apply_booking(b,'hosted-pair-offer-declined',declined,'offer',day_b+time '19:00',NULL);
 PERFORM master_wok_event_test.apply_booking(b,'hosted-pair-reject',declined,'reject',NULL,'hosted-pair-offer-declined');
 PERFORM master_wok_event_test.move_booking_offer(a,b,'hosted-pair-forward',travelling,day_b+time '19:00');
 PERFORM master_wok_event_test.move_booking_offer(b,a,'hosted-pair-return',travelling,day_a+time '19:15');
 PERFORM master_wok_event_test.move_booking_offer(a,b,'hosted-pair-forward-again',travelling,day_b+time '19:30');
 BEGIN
  PERFORM master_wok_event_test.seed_cutover_pair(a,na,b,nb,'hosted-pair-failed');
  RAISE EXCEPTION 'INJECTED_AFTER_PAIRED_SEED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'INJECTED_AFTER_PAIRED_SEED' THEN RAISE; END IF; END;
 ASSERT (SELECT count(*)=2 FROM master_wok_event_test.streams WHERE id IN(a,b) AND enabled),'failed cutover retired source';
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id IN(na,nb)),'partial baseline';
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.booking_rows WHERE stream_id IN(na,nb)),'partial booking projection';
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.booking_commands WHERE stream_id IN(na,nb)),'partial receipts';
 BEGIN
  DELETE FROM master_wok_event_test.booking_items WHERE stream_id=b AND order_id=confirmed;
  PERFORM master_wok_event_test.seed_cutover_pair(a,na,b,nb,'hosted-pair-partial-basket');RAISE EXCEPTION 'PARTIAL_BASKET_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'COMPLETE_BASKET_REQUIRED' THEN RAISE; END IF; END;
 BEGIN
  DELETE FROM master_wok_event_test.booking_transfers WHERE request_id='hosted-pair-return';
  PERFORM master_wok_event_test.seed_cutover_pair(a,na,b,nb,'hosted-pair-missing-receipt');RAISE EXCEPTION 'MISSING_RECEIPT_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CUTOVER_TRANSFER_HISTORY_REQUIRED' THEN RAISE; END IF; END;
 BEGIN
  UPDATE master_wok_event_test.events SET payload=jsonb_set(payload,'{toServiceDate}','"2099-01-01"') WHERE event_id='hosted-pair-return_out';
  PERFORM master_wok_event_test.seed_cutover_pair(a,na,b,nb,'hosted-pair-wrong-event-date');RAISE EXCEPTION 'WRONG_EVENT_DATE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CUTOVER_TRANSFER_BINDING_REQUIRED' THEN RAISE; END IF; END;
 BEGIN
  UPDATE master_wok_event_test.booking_transfers SET command=jsonb_set(command,'{target}','"2099-01-01T18:00:00Z"') WHERE request_id='hosted-pair-return';
  PERFORM master_wok_event_test.seed_cutover_pair(a,na,b,nb,'hosted-pair-wrong-receipt-target');RAISE EXCEPTION 'WRONG_RECEIPT_TARGET_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CUTOVER_TRANSFER_BINDING_REQUIRED' THEN RAISE; END IF; END;
 ASSERT master_wok_event_test.seed_cutover_pair(a,na,b,nb,'hosted-pair-cutover')='RECORDED';
 ASSERT (SELECT last_at FROM master_wok_event_test.streams WHERE id=na)=(SELECT last_at FROM master_wok_event_test.streams WHERE id=nb),'different cutover clocks';
 ASSERT (SELECT count(*)=3 FROM master_wok_event_test.reservations WHERE stream_id IN(na,nb)),'wrong capacity total';
 initial:=master_wok_event_test.export_transfer_pair(na,nb);
 ASSERT jsonb_array_length(initial->'transfers')=0,'historical moves copied into prospective log';
 PERFORM pg_sleep(0.01);
 BEGIN
  PERFORM master_wok_event_test.apply_booking(nb,'hosted-pair-stale-response',travelling,'accept',NULL,'hosted-pair-forward_in');RAISE EXCEPTION 'STALE_RESPONSE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STALE_PROPOSAL_RESPONSE' THEN RAISE; END IF; END;
 PERFORM master_wok_event_test.apply_booking(nb,'hosted-pair-accept-after',travelling,'accept',NULL,'hosted-pair-forward-again_in');
 ASSERT (SELECT count(*)=3 FROM master_wok_event_test.reservations WHERE stream_id IN(na,nb)),'acceptance duplicated capacity';
 PERFORM master_wok_event_test.move_booking_offer(nb,na,'hosted-pair-new-return',travelling,day_a+time '20:00');
 PERFORM master_wok_event_test.apply_booking(nb,'hosted-pair-complete-declined',declined,'complete',NULL,NULL);
 BEGIN
  PERFORM master_wok_event_test.move_booking_offer(na,nb,'hosted-pair-forward-again',travelling,day_b+time '19:30');RAISE EXCEPTION 'OLD_TRANSFER_RETRIED_AS_NEW';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'REQUEST_ID_REUSED' THEN RAISE; END IF; END;
 ASSERT master_wok_event_test.seed_cutover_pair(b,nb,a,na,'hosted-pair-cutover')='ALREADY_RECORDED';
 ASSERT (SELECT count(*)=2 FROM master_wok_event_test.reservations WHERE stream_id=na);
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id=nb);
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.streams WHERE id IN(a,b) AND enabled);
 final:=master_wok_event_test.export_transfer_pair(na,nb);
 ASSERT jsonb_array_length(final->'transfers')=1,'wrong prospective transfer count';
 ASSERT (SELECT count(*)=4 FROM master_wok_event_test.booking_transfers WHERE source_stream IN(a,b,na,nb)),'old receipts not preserved';
 PERFORM set_config('master_wok_trial.paired_cutover_export',jsonb_build_object('initial',initial,'final',final)::text,true);
END $test$;
SELECT true AS paired_cutover_checks_passed,current_setting('master_wok_trial.paired_cutover_export')::jsonb AS captures;
ROLLBACK;
