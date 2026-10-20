-- Candidate record() definition required; run inside BEGIN/ROLLBACK.

INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('81dcfdcb-85a5-4f08-9c67-0d6fef49884c','2026-10-21',true);
DO $$
DECLARE stream uuid:='81dcfdcb-85a5-4f08-9c67-0d6fef49884c'; e jsonb;
BEGIN
 e:=jsonb_build_object('eventId','guard-in','at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','RESERVATION_TRANSFERRED_IN','transferId','guard-transfer','fromServiceDate','2026-10-20','actualDecision','SUGGESTED','order',jsonb_build_object('orderId','synthetic-guard','orderType','delivery','targetAt','2026-10-21T18:00:00Z','lines','[{"itemId":"jasmine-rice","qty":1,"mods":[]}]'::jsonb,'deliveryReadyEstimate','{}'::jsonb));
 BEGIN
  PERFORM master_wok_event_test.record(stream,e);RAISE EXCEPTION 'EXPECTED_ESTIMATE_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TRANSFER_ESTIMATE_REFUSED' THEN RAISE; END IF; END;
 ASSERT (SELECT event_count=0 FROM master_wok_event_test.streams WHERE id=stream);
 e:=jsonb_set(e,'{order,deliveryReadyEstimate}','null'::jsonb);
 PERFORM master_wok_event_test.record(stream,e);
 BEGIN
  PERFORM master_wok_event_test.record(stream,e||'{"eventId":"reused-transfer"}'::jsonb);RAISE EXCEPTION 'EXPECTED_TRANSFER_ID_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TRANSFER_ID_REUSED' THEN RAISE; END IF; END;
 ASSERT (SELECT event_count=1 FROM master_wok_event_test.streams WHERE id=stream);
END $$;
SELECT true AS transfer_guard_checks_passed;
