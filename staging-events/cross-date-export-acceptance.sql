-- Export-only synthetic rows, not a rerun of booking mutation functions.
-- Candidate transfer table and export function required inside BEGIN/ROLLBACK.
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES
 ('006c357b-7af5-4907-a3b7-26b2e095ea9b','2026-10-20',true),('c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f','2026-10-21',true);
DO $$
DECLARE a uuid:='006c357b-7af5-4907-a3b7-26b2e095ea9b';z uuid:='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f';o jsonb;other_order jsonb;
BEGIN
 o:='{"orderId":"synthetic-cross-date","orderType":"collection","targetAt":"2026-10-20T18:00:00Z","lines":[{"itemId":"jasmine-rice","qty":1,"mods":[]}],"deliveryReadyEstimate":null}'::jsonb;
 other_order:=o||'{"targetAt":"2026-10-21T18:00:00Z"}'::jsonb;
 INSERT INTO master_wok_event_test.events VALUES
 (a,1,'bundle-create',jsonb_build_object('sequence',1,'eventId','bundle-create','at','2026-10-20T10:00:00Z','kind','RESERVATION_SET','commitment','PROPOSED','order',o)),
 (a,2,'bundle-forward_out','{"sequence":2,"eventId":"bundle-forward_out","at":"2026-10-20T10:01:00.000000Z","kind":"RESERVATION_TRANSFERRED_OUT","transferId":"bundle-forward","orderId":"synthetic-cross-date","toServiceDate":"2026-10-21"}'),
 (z,1,'bundle-forward_in',jsonb_build_object('sequence',1,'eventId','bundle-forward_in','at','2026-10-20T10:01:00.000000Z','kind','RESERVATION_TRANSFERRED_IN','transferId','bundle-forward','fromServiceDate','2026-10-20','actualDecision','SUGGESTED','order',other_order)),
 (z,2,'bundle-back_out','{"sequence":2,"eventId":"bundle-back_out","at":"2026-10-20T10:02:00.000000Z","kind":"RESERVATION_TRANSFERRED_OUT","transferId":"bundle-back","orderId":"synthetic-cross-date","toServiceDate":"2026-10-20"}'),
 (a,3,'bundle-back_in',jsonb_build_object('sequence',3,'eventId','bundle-back_in','at','2026-10-20T10:02:00.000000Z','kind','RESERVATION_TRANSFERRED_IN','transferId','bundle-back','fromServiceDate','2026-10-21','actualDecision','SUGGESTED','order',o||'{"targetAt":"2026-10-20T19:00:00Z"}'::jsonb)),
 (a,4,'bundle-complete','{"sequence":4,"eventId":"bundle-complete","at":"2026-10-20T10:03:00Z","kind":"RESERVATION_RELEASED","orderId":"synthetic-cross-date","reason":"COMPLETED"}');
 UPDATE master_wok_event_test.streams SET event_count=4,last_at='2026-10-20T10:03:00Z' WHERE id=a;
 UPDATE master_wok_event_test.streams SET event_count=2,last_at='2026-10-20T10:02:00Z' WHERE id=z;
 INSERT INTO master_wok_event_test.booking_transfers VALUES
 ('bundle-forward',a,z,jsonb_build_object('target','2026-10-21T18:00:00Z'),'2026-10-20T10:01:00Z'),
 ('bundle-back',z,a,jsonb_build_object('target','2026-10-20T19:00:00Z'),'2026-10-20T10:02:00Z');
 ASSERT (SELECT provolatile='s' AND NOT prosecdef FROM pg_proc WHERE oid='master_wok_event_test.export_transfer_pair(uuid,uuid)'::regprocedure);
END $$;
SAVEPOINT third_case;
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('0d2b36b2-1ee8-4c41-8ec9-e18c3b02d311','2026-10-22',true);
INSERT INTO master_wok_event_test.booking_transfers VALUES('bundle-third','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f','0d2b36b2-1ee8-4c41-8ec9-e18c3b02d311','{}','2026-10-20T10:04:00Z');
DO $$ BEGIN
 BEGIN
  PERFORM master_wok_event_test.export_transfer_pair('006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f');RAISE EXCEPTION 'EXPECTED_CLOSURE_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TRANSFER_CLOSURE_REQUIRED' THEN RAISE; END IF; END;
END $$;
ROLLBACK TO third_case;
UPDATE master_wok_event_test.streams SET enabled=false WHERE id='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f';
DO $$ BEGIN
 BEGIN
  PERFORM master_wok_event_test.export_transfer_pair('006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f');RAISE EXCEPTION 'EXPECTED_DISABLED_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TWO_COMPLETE_STREAMS_REQUIRED' THEN RAISE; END IF; END;
END $$;
UPDATE master_wok_event_test.streams SET enabled=true WHERE id='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f';
SELECT master_wok_event_test.export_transfer_pair('006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f') AS bundle;
