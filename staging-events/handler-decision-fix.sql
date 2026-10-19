CREATE OR REPLACE FUNCTION master_wok_event_test.handle(p_stream uuid,p_request text,p_command jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; o master_wok_event_test.orders%ROWTYPE;
 prior jsonb; e jsonb; basket jsonb; action text; oid text; at_time text; keys text[]; r text;
BEGIN
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_stream FOR UPDATE;
 IF NOT s.enabled THEN RAISE EXCEPTION 'SOURCE_DISABLED'; END IF;
 IF coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'COMMAND_REQUIRED'; END IF;
 SELECT command INTO prior FROM master_wok_event_test.commands WHERE stream_id=p_stream AND request_id=p_request;
 IF FOUND THEN
  IF prior=p_command THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 SELECT array_agg(x ORDER BY x) INTO keys FROM jsonb_object_keys(p_command) x;
 IF keys IS DISTINCT FROM ARRAY['action','orderId','proposalEventId','targetAt'] THEN RAISE EXCEPTION 'COMMAND_REQUIRED'; END IF;
 action:=p_command->>'action';oid:=p_command->>'orderId';
 IF coalesce(action,'') NOT IN ('offer','confirm','accept','reject','cancel','complete') THEN RAISE EXCEPTION 'ACTION_REQUIRED'; END IF;
 SELECT * INTO STRICT o FROM master_wok_event_test.orders WHERE stream_id=p_stream AND order_id=oid FOR UPDATE;
 IF o.status IN ('cancelled','completed') THEN RAISE EXCEPTION 'TERMINAL_ORDER'; END IF;
 at_time:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 e:=jsonb_build_object('eventId',p_request,'at',at_time,'orderId',oid);
 IF action IN ('offer','confirm') THEN
  IF jsonb_typeof(p_command->'targetAt') IS DISTINCT FROM 'string' OR p_command->'proposalEventId'<>'null'::jsonb THEN RAISE EXCEPTION 'TARGET_REQUIRED'; END IF;
  basket:=jsonb_set(o.payload,'{targetAt}',p_command->'targetAt');
  e:=(e-'orderId')||jsonb_build_object('kind','BOOKING_DECISION','order',basket,'actualDecision',CASE WHEN action='offer' THEN 'SUGGESTED' ELSE 'ACCEPTED' END);
 ELSIF action IN ('accept','reject') THEN
  IF p_command->'targetAt'<>'null'::jsonb OR jsonb_typeof(p_command->'proposalEventId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'PROPOSAL_REQUIRED'; END IF;
  e:=e||jsonb_build_object('kind','PROPOSAL_RESPONSE','proposalEventId',p_command->>'proposalEventId','response',CASE WHEN action='accept' THEN 'ACCEPTED' ELSE 'REJECTED' END);
 ELSE
  IF p_command->'targetAt'<>'null'::jsonb OR p_command->'proposalEventId'<>'null'::jsonb THEN RAISE EXCEPTION 'RELEASE_REQUIRED'; END IF;
  e:=e||jsonb_build_object('kind','RESERVATION_RELEASED','reason',CASE WHEN action='cancel' THEN 'CANCELLED' ELSE 'COMPLETED' END);
 END IF;
 r:=master_wok_event_test.record(p_stream,e);
 UPDATE master_wok_event_test.orders SET status=CASE action WHEN 'offer' THEN 'proposed' WHEN 'confirm' THEN 'confirmed' WHEN 'accept' THEN 'confirmed' WHEN 'reject' THEN 'needs_time' WHEN 'cancel' THEN 'cancelled' ELSE 'completed' END WHERE stream_id=p_stream AND order_id=oid;
 INSERT INTO master_wok_event_test.commands VALUES(p_stream,p_request,p_command);
 RETURN r;
END $$;
