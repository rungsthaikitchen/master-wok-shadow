DO $test$
DECLARE sid uuid; day date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date;
 cmd jsonb; target text; n integer; current_commitment text;
BEGIN
 INSERT INTO master_wok_event_test.streams(service_date,enabled) VALUES(day,true) RETURNING id INTO sid;
 INSERT INTO master_wok_event_test.orders VALUES(sid,'synthetic-handler',jsonb_build_object('orderId','synthetic-handler','orderType','collection','targetAt',to_char(day,'YYYY-MM-DD')||'T17:00:00+01:00','lines','[{"itemId":"panang-curry","qty":1,"mods":[{"id":"chicken"}]}]'::jsonb,'deliveryReadyEstimate',NULL),'pending');
 cmd:=jsonb_build_object('action','confirm','orderId','synthetic-handler','targetAt',day::text||'T17:00:00+01:00','proposalEventId',NULL);
 PERFORM master_wok_event_test.handle(sid,'handler-confirm',cmd);
 cmd:=jsonb_set(cmd,'{action}','"offer"');cmd:=jsonb_set(cmd,'{targetAt}',to_jsonb(day::text||'T18:00:00+01:00'));
 PERFORM master_wok_event_test.handle(sid,'handler-offer1',cmd);
 cmd:=jsonb_set(cmd,'{targetAt}',to_jsonb(day::text||'T19:00:00+01:00'));
 PERFORM master_wok_event_test.handle(sid,'handler-offer2',cmd);
 IF master_wok_event_test.handle(sid,'handler-offer2',cmd)<>'ALREADY_RECORDED' THEN RAISE EXCEPTION 'TEST_RETRY'; END IF;
 IF (SELECT count(*) FROM master_wok_event_test.reservations WHERE stream_id=sid)<>1 THEN RAISE EXCEPTION 'TEST_DOUBLE_RESERVATION'; END IF;
 IF (SELECT order_payload->>'targetAt' FROM master_wok_event_test.reservations WHERE stream_id=sid)<>day::text||'T19:00:00+01:00' THEN RAISE EXCEPTION 'TEST_REPLACEMENT'; END IF;
 cmd:=jsonb_build_object('action','accept','orderId','synthetic-handler','targetAt',NULL,'proposalEventId','handler-offer1');
 BEGIN
  PERFORM master_wok_event_test.handle(sid,'handler-stale',cmd);
  RAISE EXCEPTION 'TEST_STALE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STALE_PROPOSAL_RESPONSE' THEN RAISE; END IF; END;
 cmd:=jsonb_set(cmd,'{proposalEventId}','"handler-offer2"');
 BEGIN
  PERFORM master_wok_event_test.handle(sid,'handler-accept',cmd);
  RAISE EXCEPTION 'FORCED_HANDLER_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'FORCED_HANDLER_ROLLBACK' THEN RAISE; END IF; END;
 IF EXISTS(SELECT FROM master_wok_event_test.commands WHERE stream_id=sid AND request_id='handler-accept') OR (SELECT status FROM master_wok_event_test.orders WHERE stream_id=sid)<>'proposed' THEN RAISE EXCEPTION 'TEST_HANDLER_ATOMICITY'; END IF;
 PERFORM master_wok_event_test.handle(sid,'handler-accept',cmd);
 IF (SELECT commitment FROM master_wok_event_test.reservations WHERE stream_id=sid)<>'CONFIRMED' THEN RAISE EXCEPTION 'TEST_ACCEPT'; END IF;
 cmd:=jsonb_build_object('action','offer','orderId','synthetic-handler','targetAt',day::text||'T19:30:00+01:00','proposalEventId',NULL);
 PERFORM master_wok_event_test.handle(sid,'handler-offer3',cmd);
 cmd:=jsonb_build_object('action','reject','orderId','synthetic-handler','targetAt',NULL,'proposalEventId','handler-offer3');
 PERFORM master_wok_event_test.handle(sid,'handler-reject',cmd);
 IF EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id=sid) THEN RAISE EXCEPTION 'TEST_REJECT'; END IF;
 cmd:=jsonb_build_object('action','confirm','orderId','synthetic-handler','targetAt',day::text||'T20:00:00+01:00','proposalEventId',NULL);
 PERFORM master_wok_event_test.handle(sid,'handler-confirm2',cmd);
 cmd:=jsonb_build_object('action','cancel','orderId','synthetic-handler','targetAt',NULL,'proposalEventId',NULL);
 PERFORM master_wok_event_test.handle(sid,'handler-cancel',cmd);
 IF (SELECT event_count FROM master_wok_event_test.streams WHERE id=sid)<>8 OR EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id=sid) THEN RAISE EXCEPTION 'TEST_FINAL_COUNT'; END IF;
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id=sid;
END $test$;
SELECT id::text AS stream_id,scope,event_count,master_wok_event_test.export(id) AS batch FROM master_wok_event_test.streams WHERE event_count=8;
