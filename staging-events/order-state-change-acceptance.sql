-- Private staging only. Run with candidate record/apply_booking definitions inside BEGIN/ROLLBACK.
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('e934bdd2-0f81-45c6-839f-d648642bb248','2026-10-20',true);
DO $$
DECLARE s uuid:='e934bdd2-0f81-45c6-839f-d648642bb248'; o uuid; action text; alias text; n integer:=0;
BEGIN
 FOREACH action IN ARRAY ARRAY['cancel','complete'] LOOP
  n:=n+1; o:=gen_random_uuid(); alias:='synthetic-terminal-'||n;
  PERFORM master_wok_event_test.create_booking(s,'create-'||n,o,alias,'2026-10-20T17:00:00Z','[{"item_id":"jasmine-rice","qty":1,"modifiers":[]}]');
  PERFORM master_wok_event_test.apply_booking(s,'offer-'||n,o,'offer','2026-10-20T18:00:00Z');
  PERFORM master_wok_event_test.apply_booking(s,'reject-'||n,o,'reject',NULL,'offer-'||n);
  ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id=s AND order_id=alias);
  PERFORM master_wok_event_test.apply_booking(s,'terminal-'||n,o,action);
  ASSERT master_wok_event_test.apply_booking(s,'terminal-'||n,o,action)='ALREADY_RECORDED';
  ASSERT (SELECT status=CASE action WHEN 'cancel' THEN 'cancelled' ELSE 'completed' END FROM master_wok_event_test.booking_rows WHERE stream_id=s AND id=o);
  ASSERT (SELECT payload->>'kind'='ORDER_STATE_CHANGED' FROM master_wok_event_test.events WHERE stream_id=s AND event_id='terminal-'||n);
  ASSERT NOT EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id=s AND order_id=alias);
 END LOOP;
 ASSERT (SELECT event_count=8 FROM master_wok_event_test.streams WHERE id=s);
 BEGIN
  PERFORM master_wok_event_test.record(s,jsonb_build_object('eventId','unknown','at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','ORDER_STATE_CHANGED','orderId','synthetic-unknown','status','CANCELLED'));
  RAISE EXCEPTION 'EXPECTED_UNKNOWN_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ORDER_STATE_CHANGE_REQUIRED' THEN RAISE; END IF; END;
END $$;
SELECT master_wok_event_test.export('e934bdd2-0f81-45c6-839f-d648642bb248'::uuid) AS replay_batch;
