-- Run candidate definitions and this fixture inside BEGIN/ROLLBACK only.
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES
 ('006c357b-7af5-4907-a3b7-26b2e095ea9b','2026-10-20',true),('c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f','2026-10-21',true);
SELECT master_wok_event_test.create_booking('006c357b-7af5-4907-a3b7-26b2e095ea9b','move-create','83b2dfbe-5f28-4e61-8100-ad8b5bb4c398','synthetic-cross-date','2026-10-20T18:00:00Z','[{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]');
ALTER TABLE master_wok_event_test.booking_rows ADD CONSTRAINT cross_date_force_failure CHECK(stream_id<>'006c357b-7af5-4907-a3b7-26b2e095ea9b'::uuid OR status<>'moved_service_date');
DO $$ BEGIN
 BEGIN
  PERFORM master_wok_event_test.move_booking_offer('006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f','move-failed','83b2dfbe-5f28-4e61-8100-ad8b5bb4c398','2026-10-21T18:00:00Z');
  RAISE EXCEPTION 'EXPECTED_AFTER_EVENTS_FAILURE';
 EXCEPTION WHEN check_violation THEN NULL; END;
 ASSERT (SELECT event_count=1 FROM master_wok_event_test.streams WHERE id='006c357b-7af5-4907-a3b7-26b2e095ea9b');
 ASSERT (SELECT event_count=0 FROM master_wok_event_test.streams WHERE id='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f');
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id IN ('006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f'));
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.booking_rows WHERE stream_id='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f');
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.booking_transfers);
END $$;
ALTER TABLE master_wok_event_test.booking_rows DROP CONSTRAINT cross_date_force_failure;
DO $$
DECLARE a uuid:='006c357b-7af5-4907-a3b7-26b2e095ea9b'; z uuid:='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f'; o uuid:='83b2dfbe-5f28-4e61-8100-ad8b5bb4c398';
BEGIN
 ASSERT master_wok_event_test.move_booking_offer(a,z,'move-forward',o,'2026-10-21T18:00:00Z')='RECORDED';
 ASSERT master_wok_event_test.move_booking_offer(a,z,'move-forward',o,'2026-10-21T18:00:00Z')='ALREADY_RECORDED';
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id=a);
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id=z);
 ASSERT (SELECT status='moved_service_date' AND current_proposal_event_id IS NULL FROM master_wok_event_test.booking_rows WHERE stream_id=a AND id=o);
 BEGIN
  PERFORM master_wok_event_test.apply_booking(a,'stale-source-reply',o,'accept',NULL,'move-create');RAISE EXCEPTION 'EXPECTED_MOVED_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ORDER_MOVED_SERVICE_DATE' THEN RAISE; END IF; END;
 BEGIN
  PERFORM master_wok_event_test.apply_booking(a,'old-source-offer',o,'offer','2026-10-20T19:00:00Z');RAISE EXCEPTION 'EXPECTED_MOVED_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ORDER_MOVED_SERVICE_DATE' THEN RAISE; END IF; END;
 BEGIN
  PERFORM master_wok_event_test.move_booking_offer(a,z,'move-forward',o,'2026-10-21T19:00:00Z');RAISE EXCEPTION 'EXPECTED_CHANGED_RETRY';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'REQUEST_ID_REUSED' THEN RAISE; END IF; END;
 PERFORM master_wok_event_test.apply_booking(z,'accept-new-day',o,'accept',NULL,'move-forward_in');
 ASSERT (SELECT commitment='CONFIRMED' FROM master_wok_event_test.reservations WHERE stream_id=z);
 -- Reusing the existing moved projection on the original day must be safe.
 PERFORM master_wok_event_test.move_booking_offer(z,a,'move-back',o,'2026-10-20T19:00:00Z');
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id IN (a,z));
 ASSERT (SELECT commitment='PROPOSED' AND proposal_event_id='move-back_in' FROM master_wok_event_test.reservations WHERE stream_id=a);
 ASSERT (SELECT preferred_time='2026-10-20T18:00:00Z' AND proposed_time='2026-10-20T19:00:00Z' AND confirmed_time IS NULL FROM master_wok_event_test.booking_rows WHERE stream_id=a AND id=o);
 ASSERT (SELECT count(*)=2 FROM master_wok_event_test.booking_items WHERE stream_id IN (a,z) AND order_id=o);
 PERFORM master_wok_event_test.apply_booking(a,'reject-return-offer',o,'reject',NULL,'move-back_in');
 PERFORM master_wok_event_test.apply_booking(a,'close-return-order',o,'complete');
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id IN (a,z));
 ASSERT (SELECT count(*)=2 FROM master_wok_event_test.booking_transfers);
END $$;
DO $$
DECLARE a uuid:='006c357b-7af5-4907-a3b7-26b2e095ea9b'; z uuid:='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f'; o uuid:='ffac7dfe-1370-4711-bbfa-7be0510ae42a'; plan jsonb;
BEGIN
 BEGIN
  plan:=jsonb_build_object('basis','PREPARED_HYPOTHETICAL_DELIVERY_PLAN','eventId','delivery-create-cross','orderId','synthetic-cross-delivery','targetAt','2026-10-20T18:00:00Z','lines','[{"itemId":"jasmine-rice","qty":1,"mods":[]}]'::jsonb,'routeEvidenceRef','synthetic-old-day-routes','estimate',jsonb_build_object('basis','DELIVERY_PLANNER_ESTIMATE','foodReadyAt','2026-10-20T17:50:00Z','arrivalAt','2026-10-20T18:00:00Z','estimatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  PERFORM master_wok_event_test.create_delivery_booking(a,'delivery-create-cross',o,'synthetic-cross-delivery','2026-10-20T18:00:00Z','[{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]',plan);
  BEGIN
   PERFORM master_wok_event_test.record(z,jsonb_build_object('eventId','illegal-carried-plan','at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','RESERVATION_TRANSFERRED_IN','order',master_wok_event_test.booking_payload(a,o,'2026-10-21T18:00:00Z')||jsonb_build_object('deliveryReadyEstimate',plan->'estimate'),'actualDecision','SUGGESTED','transferId','illegal-carried','fromServiceDate','2026-10-20'));
   RAISE EXCEPTION 'EXPECTED_TRANSFER_ESTIMATE_REFUSAL';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TRANSFER_ESTIMATE_REFUSED' THEN RAISE; END IF; END;
  PERFORM master_wok_event_test.move_booking_offer(a,z,'delivery-move',o,'2026-10-21T18:00:00Z');
  ASSERT (SELECT order_payload->'deliveryReadyEstimate'='null'::jsonb FROM master_wok_event_test.reservations WHERE stream_id=z AND order_id='synthetic-cross-delivery');
  BEGIN
   PERFORM master_wok_event_test.apply_delivery_booking(a,'old-delivery-offer',o,'offer','2026-10-20T19:00:00Z');RAISE EXCEPTION 'EXPECTED_MOVED_DELIVERY_REFUSAL';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ORDER_MOVED_SERVICE_DATE' THEN RAISE; END IF; END;
  RAISE EXCEPTION 'ROLLBACK_DELIVERY_CASE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ROLLBACK_DELIVERY_CASE' THEN RAISE; END IF; END;
 BEGIN
  PERFORM master_wok_event_test.create_booking(a,'collision-a',o,'synthetic-collision','2026-10-20T18:00:00Z','[{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]');
  PERFORM master_wok_event_test.create_booking(z,'collision-z',o,'synthetic-collision','2026-10-21T18:00:00Z','[{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]');
  BEGIN
   PERFORM master_wok_event_test.move_booking_offer(a,z,'occupied-move',o,'2026-10-21T19:00:00Z');RAISE EXCEPTION 'EXPECTED_OCCUPIED_REFUSAL';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TRANSFER_DESTINATION_OCCUPIED' THEN RAISE; END IF; END;
  RAISE EXCEPTION 'ROLLBACK_COLLISION_CASE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ROLLBACK_COLLISION_CASE' THEN RAISE; END IF; END;
END $$;
SELECT master_wok_event_test.export('006c357b-7af5-4907-a3b7-26b2e095ea9b') AS source_batch,master_wok_event_test.export('c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f') AS destination_batch;
