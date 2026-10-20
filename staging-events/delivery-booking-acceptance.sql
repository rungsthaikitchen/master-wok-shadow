-- Candidate functions/constraint and all fixtures must be wrapped in BEGIN/ROLLBACK.
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('b8a7c452-d5a9-46af-899b-d43938d5ee82','2026-10-20',true);
DO $$
DECLARE s uuid:='b8a7c452-d5a9-46af-899b-d43938d5ee82'; o uuid:='43fb95b1-326e-4cab-b7ef-5144fd328924'; plan jsonb; lines jsonb:='[{"item_id":"panang-curry","qty":1,"modifiers":[{"id":"chicken"}]}]'; before_count integer; bad jsonb; n integer;
BEGIN
 -- A failed basket must not leave a row or event.
 BEGIN
  PERFORM master_wok_event_test.create_delivery_booking(s,'bad-create',o,'synthetic-delivery','2026-10-20T17:00:00Z','[{"item_id":"panang-curry","qty":0,"modifiers":[]}]');
  RAISE EXCEPTION 'EXPECTED_BAD_BASKET';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LINE_REQUIRED' THEN RAISE; END IF; END;
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.booking_rows WHERE stream_id=s);
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.events WHERE stream_id=s);
 PERFORM master_wok_event_test.create_delivery_booking(s,'delivery-create',o,'synthetic-delivery','2026-10-20T17:00:00Z',lines);
 ASSERT master_wok_event_test.create_delivery_booking(s,'delivery-create',o,'synthetic-delivery','2026-10-20T17:00:00Z',lines)='ALREADY_RECORDED';
 ASSERT (SELECT order_type='delivery' FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=o);
 ASSERT (SELECT payload->'order'->>'orderType'='delivery' AND payload->'order'->'deliveryReadyEstimate'='null'::jsonb FROM master_wok_event_test.events WHERE stream_id=s AND event_id='delivery-create');
END $$;
-- Force a failure after record(), then verify the whole offer rolls back.
ALTER TABLE master_wok_event_test.booking_rows ADD CONSTRAINT delivery_force_failure CHECK(stream_id<>'b8a7c452-d5a9-46af-899b-d43938d5ee82'::uuid OR status<>'proposed');
DO $$
BEGIN
 BEGIN
  PERFORM master_wok_event_test.apply_delivery_booking('b8a7c452-d5a9-46af-899b-d43938d5ee82','failed-offer','43fb95b1-326e-4cab-b7ef-5144fd328924','offer','2026-10-20T18:00:00Z');
  RAISE EXCEPTION 'EXPECTED_ROLLBACK';
 EXCEPTION WHEN check_violation THEN NULL; END;
 ASSERT (SELECT event_count=1 FROM master_wok_event_test.streams WHERE id='b8a7c452-d5a9-46af-899b-d43938d5ee82');
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.booking_commands WHERE stream_id='b8a7c452-d5a9-46af-899b-d43938d5ee82' AND request_id='failed-offer');
 ASSERT (SELECT (order_payload->>'targetAt')::timestamptz='2026-10-20T17:00:00Z' FROM master_wok_event_test.reservations WHERE stream_id='b8a7c452-d5a9-46af-899b-d43938d5ee82');
END $$;
ALTER TABLE master_wok_event_test.booking_rows DROP CONSTRAINT delivery_force_failure;
DO $$
DECLARE s uuid:='b8a7c452-d5a9-46af-899b-d43938d5ee82'; o uuid:='43fb95b1-326e-4cab-b7ef-5144fd328924'; plan jsonb; bad jsonb; n integer;
BEGIN
 plan:=jsonb_build_object('basis','PREPARED_HYPOTHETICAL_DELIVERY_PLAN','eventId','delivery-offer-1','orderId','synthetic-delivery','targetAt','2026-10-20T18:00:00Z',
  'lines',master_wok_event_test.booking_payload(s,o,'2026-10-20T18:00:00Z')->'lines','routeEvidenceRef','synthetic-route-fixture-1',
  'estimate',jsonb_build_object('foodReadyAt','2026-10-20T17:55:00Z','arrivalAt','2026-10-20T18:10:00Z','estimatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'basis','DELIVERY_PLANNER_ESTIMATE'));
 -- Reject wrong event/version, basket, target, future/stale estimate and >20 minute age.
 FOR n IN 1..6 LOOP
  bad:=CASE n WHEN 1 THEN plan||'{"eventId":"another-offer"}'::jsonb
   WHEN 2 THEN plan||'{"lines":[]}'::jsonb WHEN 3 THEN plan||'{"targetAt":"2026-10-20T18:30:00Z"}'::jsonb
   WHEN 4 THEN jsonb_set(plan,'{estimate,estimatedAt}',to_jsonb('2026-10-21T07:00:00Z'::text))
   WHEN 5 THEN jsonb_set(plan,'{estimate,estimatedAt}',to_jsonb('2026-10-19T07:00:00Z'::text))
   ELSE jsonb_set(plan,'{estimate,foodReadyAt}',to_jsonb('2026-10-20T17:49:59Z'::text)) END;
  BEGIN
   PERFORM master_wok_event_test.apply_delivery_booking(s,'delivery-offer-1',o,'offer','2026-10-20T18:00:00Z',bad);
   RAISE EXCEPTION 'EXPECTED_PLAN_REFUSAL';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT IN ('DELIVERY_PLAN_BINDING_REQUIRED','DELIVERY_ESTIMATE_UNVERIFIED') THEN RAISE; END IF; END;
 END LOOP;
 ASSERT (SELECT event_count=1 FROM master_wok_event_test.streams WHERE id=s);
 PERFORM master_wok_event_test.apply_delivery_booking(s,'delivery-offer-1',o,'offer','2026-10-20T18:00:00Z',plan);
 ASSERT master_wok_event_test.apply_delivery_booking(s,'delivery-offer-1',o,'offer','2026-10-20T18:00:00Z',plan)='ALREADY_RECORDED';
 ASSERT (SELECT order_payload->'deliveryReadyEstimate'=plan->'estimate' FROM master_wok_event_test.reservations WHERE stream_id=s);
 ASSERT (SELECT command->'planning'=plan FROM master_wok_event_test.booking_commands WHERE stream_id=s AND request_id='delivery-offer-1');
 -- A fresh offer without evidence must not inherit the prior estimate.
 PERFORM master_wok_event_test.apply_delivery_booking(s,'delivery-offer-2',o,'offer','2026-10-20T18:30:00Z');
 ASSERT (SELECT order_payload->'deliveryReadyEstimate'='null'::jsonb AND (order_payload->>'targetAt')::timestamptz='2026-10-20T18:30:00Z' FROM master_wok_event_test.reservations WHERE stream_id=s);
 BEGIN
  PERFORM master_wok_event_test.apply_booking(s,'stale-delivery-response',o,'accept',NULL,'delivery-offer-1');
  RAISE EXCEPTION 'EXPECTED_STALE_REPLY';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STALE_PROPOSAL_RESPONSE' THEN RAISE; END IF; END;
 -- Same target, new proposal: old event-bound evidence is still refused.
 BEGIN
  PERFORM master_wok_event_test.apply_delivery_booking(s,'delivery-offer-3',o,'offer','2026-10-20T18:00:00Z',plan);
  RAISE EXCEPTION 'EXPECTED_STALE_PLAN';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'DELIVERY_PLAN_BINDING_REQUIRED' THEN RAISE; END IF; END;
 plan:=plan||'{"eventId":"delivery-offer-3"}'::jsonb;
 PERFORM master_wok_event_test.apply_delivery_booking(s,'delivery-offer-3',o,'offer','2026-10-20T18:00:00Z',plan);
 PERFORM master_wok_event_test.apply_booking(s,'delivery-accept-3',o,'accept',NULL,'delivery-offer-3');
 ASSERT master_wok_event_test.apply_booking(s,'delivery-accept-3',o,'accept',NULL,'delivery-offer-3')='ALREADY_RECORDED';
 ASSERT (SELECT commitment='CONFIRMED' AND order_payload->'deliveryReadyEstimate'=plan->'estimate' FROM master_wok_event_test.reservations WHERE stream_id=s);
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id=s);
 BEGIN
  PERFORM master_wok_event_test.apply_delivery_booking(s,'cross-day',o,'offer','2026-10-21T18:00:00Z');
  RAISE EXCEPTION 'EXPECTED_CROSS_DAY';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ORDER_TARGET_REQUIRED' THEN RAISE; END IF; END;
 PERFORM master_wok_event_test.apply_delivery_booking(s,'delivery-offer-4',o,'offer','2026-10-20T19:00:00Z');
 PERFORM master_wok_event_test.apply_booking(s,'delivery-reject-4',o,'reject',NULL,'delivery-offer-4');
 PERFORM master_wok_event_test.apply_booking(s,'delivery-complete',o,'complete');
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id=s);
 ASSERT (SELECT status='completed' AND confirmed_time IS NULL AND current_proposal_event_id IS NULL FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=o);
 ASSERT (SELECT event_count=8 FROM master_wok_event_test.streams WHERE id=s);
END $$;
-- Planned creation, explicit confirmation and existing collection behaviour.
-- Roll this secondary fixture back inside the outer acceptance transaction.
DO $$
DECLARE s uuid:='b8a7c452-d5a9-46af-899b-d43938d5ee82'; o uuid:='a6e2ff40-263f-40fc-9716-ea49d878a33a'; c uuid:='5c3d957f-c6a5-4699-baf1-83b94bd537eb'; plan jsonb;
BEGIN
 BEGIN
  plan:=jsonb_build_object('basis','PREPARED_HYPOTHETICAL_DELIVERY_PLAN','eventId','planned-create','orderId','synthetic-planned-create','targetAt','2026-10-20T17:00:00Z',
   'lines','[{"itemId":"jasmine-rice","qty":1,"mods":[]}]'::jsonb,'routeEvidenceRef','synthetic-creation-fixture',
   'estimate',jsonb_build_object('foodReadyAt','2026-10-20T16:55:00Z','arrivalAt','2026-10-20T17:10:00Z','estimatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'basis','DELIVERY_PLANNER_ESTIMATE'));
  PERFORM master_wok_event_test.create_delivery_booking(s,'planned-create',o,'synthetic-planned-create','2026-10-20T17:00:00Z','[{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]',plan);
  ASSERT (SELECT order_payload->'deliveryReadyEstimate'=plan->'estimate' FROM master_wok_event_test.reservations WHERE stream_id=s AND order_id='synthetic-planned-create');
  plan:=plan||'{"eventId":"planned-confirm"}'::jsonb;
  PERFORM master_wok_event_test.apply_delivery_booking(s,'planned-confirm',o,'confirm',NULL,plan);
  ASSERT (SELECT commitment='CONFIRMED' AND order_payload->'deliveryReadyEstimate'=plan->'estimate' FROM master_wok_event_test.reservations WHERE stream_id=s AND order_id='synthetic-planned-create');
  PERFORM master_wok_event_test.apply_booking(s,'planned-cancel',o,'cancel');
  ASSERT (SELECT payload->>'kind'='RESERVATION_RELEASED' FROM master_wok_event_test.events WHERE stream_id=s AND event_id='planned-cancel');
  PERFORM master_wok_event_test.create_booking(s,'collection-create',c,'synthetic-collection','2026-10-20T17:00:00Z','[{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]');
  ASSERT (SELECT order_type='collection' FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=c);
  PERFORM master_wok_event_test.apply_booking(s,'collection-offer',c,'offer','2026-10-20T18:00:00Z');
  PERFORM master_wok_event_test.apply_booking(s,'collection-accept',c,'accept',NULL,'collection-offer');
  ASSERT (SELECT commitment='CONFIRMED' AND order_payload->'deliveryReadyEstimate'='null'::jsonb FROM master_wok_event_test.reservations WHERE stream_id=s AND order_id='synthetic-collection');
  RAISE EXCEPTION 'ROLLBACK_SECONDARY_FIXTURE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ROLLBACK_SECONDARY_FIXTURE' THEN RAISE; END IF; END;
 ASSERT (SELECT event_count=8 FROM master_wok_event_test.streams WHERE id=s);
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.booking_rows WHERE stream_id=s);
END $$;
SELECT master_wok_event_test.export('b8a7c452-d5a9-46af-899b-d43938d5ee82'::uuid) AS replay_batch;
