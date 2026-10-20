-- Run only in private staging. All fixture rows are rolled back.
BEGIN;
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('91944cfe-ea80-48be-a196-8c4bc8079b86','2026-10-20',true);
DO $$
DECLARE s uuid:='91944cfe-ea80-48be-a196-8c4bc8079b86'; o uuid:='b1e9e63d-121c-4456-a069-a45635ec49fe';
 lines jsonb:='[{"item_id":"panang-curry","qty":1,"modifiers":[{"id":"chicken"}]},{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]';
 result text;
BEGIN
 BEGIN
  PERFORM master_wok_event_test.create_booking(s,'invalid-create',o,'synthetic-booking','2026-10-20T17:00:00Z','[{"item_id":"panang-curry","qty":1,"modifiers":[]},{"item_id":"jasmine-rice","qty":0,"modifiers":[]}]');
  RAISE EXCEPTION 'TEST_EXPECTED_BAD_BASKET';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LINE_REQUIRED' THEN RAISE; END IF; END;
 ASSERT (SELECT count(*)=0 FROM master_wok_event_test.booking_rows WHERE stream_id=s),'partial order survived';
 ASSERT (SELECT count(*)=0 FROM master_wok_event_test.events WHERE stream_id=s),'partial event survived';
 ASSERT (SELECT count(*)=0 FROM master_wok_event_test.booking_items WHERE stream_id=s),'partial basket survived';
 result:=master_wok_event_test.create_booking(s,'create-1',o,'synthetic-booking','2026-10-20T17:00:00Z',lines);
 ASSERT result='RECORDED';
 ASSERT (SELECT count(*)=2 FROM master_wok_event_test.booking_items WHERE stream_id=s),'complete basket missing';
 ASSERT master_wok_event_test.create_booking(s,'create-1',o,'synthetic-booking','2026-10-20T17:00:00Z',lines)='ALREADY_RECORDED';
 ASSERT (SELECT event_count=1 FROM master_wok_event_test.streams WHERE id=s),'duplicate creation event';
 BEGIN
  PERFORM master_wok_event_test.create_booking(s,'create-1',o,'synthetic-booking','2026-10-20T18:00:00Z',lines);
  RAISE EXCEPTION 'TEST_EXPECTED_CHANGED_RETRY';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'REQUEST_ID_REUSED' THEN RAISE; END IF; END;
 PERFORM master_wok_event_test.apply_booking(s,'confirm-1',o,'confirm');
 ASSERT (SELECT confirmed_time='2026-10-20T17:00:00Z' FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=o);
END $$;
-- Force a failure AFTER the source record() call, during the order-row update.
ALTER TABLE master_wok_event_test.booking_rows ADD CONSTRAINT acceptance_force_failure CHECK(status<>'proposed');
DO $$
DECLARE s uuid:='91944cfe-ea80-48be-a196-8c4bc8079b86'; o uuid:='b1e9e63d-121c-4456-a069-a45635ec49fe';
BEGIN
 BEGIN
  PERFORM master_wok_event_test.apply_booking(s,'failed-offer',o,'offer','2026-10-20T18:00:00Z');
  RAISE EXCEPTION 'TEST_EXPECTED_ROLLBACK';
 EXCEPTION WHEN check_violation THEN NULL; END;
 ASSERT (SELECT event_count=2 FROM master_wok_event_test.streams WHERE id=s),'event survived failed row update';
 ASSERT (SELECT commitment='CONFIRMED' AND (order_payload->>'targetAt')::timestamptz='2026-10-20T17:00:00Z' FROM master_wok_event_test.reservations WHERE stream_id=s),'reservation survived failed row update';
 ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.booking_commands WHERE stream_id=s AND request_id='failed-offer');
END $$;
ALTER TABLE master_wok_event_test.booking_rows DROP CONSTRAINT acceptance_force_failure;
DO $$
DECLARE s uuid:='91944cfe-ea80-48be-a196-8c4bc8079b86'; o uuid:='b1e9e63d-121c-4456-a069-a45635ec49fe';
BEGIN
 PERFORM master_wok_event_test.apply_booking(s,'offer-1',o,'offer','2026-10-20T18:00:00Z');
 ASSERT (SELECT preferred_time='2026-10-20T17:00:00Z' AND proposed_time='2026-10-20T18:00:00Z' AND confirmed_time IS NULL AND current_proposal_event_id='offer-1' FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=o);
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id=s);
 ASSERT (SELECT commitment='PROPOSED' AND (order_payload->>'targetAt')::timestamptz='2026-10-20T18:00:00Z' FROM master_wok_event_test.reservations WHERE stream_id=s);
 PERFORM master_wok_event_test.apply_booking(s,'accept-1',o,'accept',NULL,'offer-1');
 ASSERT master_wok_event_test.apply_booking(s,'accept-1',o,'accept',NULL,'offer-1')='ALREADY_RECORDED';
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id=s);
 ASSERT (SELECT commitment='CONFIRMED' FROM master_wok_event_test.reservations WHERE stream_id=s);
 PERFORM master_wok_event_test.apply_booking(s,'offer-2',o,'offer','2026-10-20T18:30:00Z');
 BEGIN
  PERFORM master_wok_event_test.apply_booking(s,'stale-reply',o,'accept',NULL,'offer-1');
  RAISE EXCEPTION 'TEST_EXPECTED_STALE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STALE_PROPOSAL_RESPONSE' THEN RAISE; END IF; END;
 ASSERT (SELECT event_count=5 FROM master_wok_event_test.streams WHERE id=s),'stale reply added an event';
 PERFORM master_wok_event_test.apply_booking(s,'reject-2',o,'reject',NULL,'offer-2');
 ASSERT (SELECT count(*)=0 FROM master_wok_event_test.reservations WHERE stream_id=s);
 ASSERT (SELECT status='customer_declined_time' AND confirmed_time IS NULL AND current_proposal_event_id IS NULL FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=o);
 BEGIN
  PERFORM master_wok_event_test.apply_booking(s,'bad-confirm',o,'confirm');
  RAISE EXCEPTION 'TEST_EXPECTED_NEW_OFFER';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'NEW_OFFER_REQUIRED' THEN RAISE; END IF; END;
 BEGIN
  PERFORM master_wok_event_test.apply_booking(s,'cross-day',o,'offer','2026-10-21T18:00:00Z');
  RAISE EXCEPTION 'TEST_EXPECTED_CROSS_DAY';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ORDER_TARGET_REQUIRED' THEN RAISE; END IF; END;
 ASSERT (SELECT event_count=6 FROM master_wok_event_test.streams WHERE id=s),'refused command added event';
 PERFORM master_wok_event_test.apply_booking(s,'offer-3',o,'offer','2026-10-20T19:00:00Z');
 PERFORM master_wok_event_test.apply_booking(s,'cancel-3',o,'cancel');
 ASSERT (SELECT count(*)=0 FROM master_wok_event_test.reservations WHERE stream_id=s);
 ASSERT (SELECT status='cancelled' FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=o);
 ASSERT (SELECT event_count=8 FROM master_wok_event_test.streams WHERE id=s);
 BEGIN
  PERFORM master_wok_event_test.apply_booking(s,'after-cancel',o,'offer','2026-10-20T19:00:00Z');
  RAISE EXCEPTION 'TEST_EXPECTED_TERMINAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TERMINAL_ORDER' THEN RAISE; END IF; END;
END $$;
SELECT master_wok_event_test.export('91944cfe-ea80-48be-a196-8c4bc8079b86'::uuid) AS replay_batch;
ROLLBACK;
