-- Private staging candidate only. No production tables or public grants.
-- Test inside BEGIN/ROLLBACK before installing alongside a matching consumer.
ALTER TABLE master_wok_event_test.booking_rows DROP CONSTRAINT booking_rows_order_type_check;
ALTER TABLE master_wok_event_test.booking_rows ADD CONSTRAINT booking_rows_order_type_check CHECK(order_type IN ('collection','delivery'));

CREATE FUNCTION master_wok_event_test.delivery_plan_estimate(p_order jsonb,p_event text,p_plan jsonb,p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE keys text[]; e jsonb; target timestamptz; arrival timestamptz; ready timestamptz; estimated timestamptz; v text;
BEGIN
 IF p_plan IS NULL OR p_plan='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DELIVERY_PLAN_REQUIRED'; END IF;
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(p_plan) k;
 IF keys IS DISTINCT FROM ARRAY['basis','estimate','eventId','lines','orderId','routeEvidenceRef','targetAt'] OR
  p_plan->>'basis' IS DISTINCT FROM 'PREPARED_HYPOTHETICAL_DELIVERY_PLAN' OR
  p_plan->>'eventId' IS DISTINCT FROM p_event OR p_plan->>'orderId' IS DISTINCT FROM p_order->>'orderId' OR
  p_plan->'lines' IS DISTINCT FROM p_order->'lines' OR
  coalesce(p_plan->>'routeEvidenceRef','') !~ '^synthetic-[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'DELIVERY_PLAN_BINDING_REQUIRED'; END IF;
 e:=p_plan->'estimate';
 IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DELIVERY_ESTIMATE_REQUIRED'; END IF;
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(e) k;
 IF keys IS DISTINCT FROM ARRAY['arrivalAt','basis','estimatedAt','foodReadyAt'] OR e->>'basis' IS DISTINCT FROM 'DELIVERY_PLANNER_ESTIMATE' THEN RAISE EXCEPTION 'DELIVERY_ESTIMATE_REQUIRED'; END IF;
 FOREACH v IN ARRAY ARRAY[p_plan->>'targetAt',e->>'arrivalAt',e->>'foodReadyAt',e->>'estimatedAt'] LOOP
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'DELIVERY_TIME_REQUIRED'; END IF;
 END LOOP;
 target:=(p_order->>'targetAt')::timestamptz;arrival:=(e->>'arrivalAt')::timestamptz;ready:=(e->>'foodReadyAt')::timestamptz;estimated:=(e->>'estimatedAt')::timestamptz;
 IF (p_plan->>'targetAt')::timestamptz IS DISTINCT FROM target OR estimated>p_at OR estimated<p_at-interval '30 minutes' OR
  abs(extract(epoch FROM arrival-target))>600 OR arrival-ready NOT BETWEEN interval '2 minutes' AND interval '20 minutes' OR
  (arrival AT TIME ZONE 'Europe/London')::date IS DISTINCT FROM (target AT TIME ZONE 'Europe/London')::date OR
  (ready AT TIME ZONE 'Europe/London')::date IS DISTINCT FROM (target AT TIME ZONE 'Europe/London')::date THEN RAISE EXCEPTION 'DELIVERY_ESTIMATE_UNVERIFIED'; END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.delivery_plan_estimate(jsonb,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.create_delivery_booking(p_stream uuid,p_request text,p_order uuid,p_alias text,p_preferred timestamptz,p_lines jsonb,p_plan jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; cmd jsonb; prior jsonb; line jsonb; keys text[]; n integer:=0; payload jsonb; event_at timestamptz;
BEGIN
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_stream FOR UPDATE;
 IF NOT s.enabled OR s.scope<>'SYNTHETIC_STAGING_EVENTS' THEN RAISE EXCEPTION 'SOURCE_DISABLED'; END IF;
 IF coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR p_order IS NULL OR p_preferred IS NULL THEN RAISE EXCEPTION 'CREATE_COMMAND_REQUIRED'; END IF;
 cmd:=jsonb_build_object('action','create_delivery','orderId',p_order,'alias',p_alias,'preferred',p_preferred,'lines',p_lines,'planning',p_plan);
 SELECT command INTO prior FROM master_wok_event_test.booking_commands WHERE stream_id=p_stream AND request_id=p_request;
 IF FOUND THEN
  IF prior=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'COMPLETE_BASKET_REQUIRED'; END IF;
 INSERT INTO master_wok_event_test.booking_rows(stream_id,id,order_alias,order_type,preferred_time) VALUES(p_stream,p_order,p_alias,'delivery',p_preferred);
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'LINE_REQUIRED'; END IF;
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(line) k;
  IF keys IS DISTINCT FROM ARRAY['item_id','modifiers','qty'] OR jsonb_typeof(line->'qty') IS DISTINCT FROM 'number' OR
     (line->>'qty') !~ '^[1-9][0-9]{0,2}$' OR jsonb_typeof(line->'item_id') IS DISTINCT FROM 'string' OR
     jsonb_typeof(line->'modifiers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'LINE_REQUIRED'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(line->'modifiers') m WHERE jsonb_typeof(m) IS DISTINCT FROM 'object' OR
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) IS DISTINCT FROM ARRAY['id'] OR
      jsonb_typeof(m->'id') IS DISTINCT FROM 'string' OR coalesce(m->>'id','') !~ '^[a-z0-9-]{1,80}$') THEN RAISE EXCEPTION 'MODIFIER_REQUIRED'; END IF;
  n:=n+1;
  INSERT INTO master_wok_event_test.booking_items VALUES(p_stream,p_order,n,line->>'item_id',(line->>'qty')::integer,line->'modifiers');
 END LOOP;
 payload:=master_wok_event_test.booking_payload(p_stream,p_order,p_preferred);
 event_at:=clock_timestamp();
 payload:=payload||jsonb_build_object('deliveryReadyEstimate',master_wok_event_test.delivery_plan_estimate(payload,p_request,p_plan,event_at));
 PERFORM master_wok_event_test.record(p_stream,jsonb_build_object('eventId',p_request,'at',to_char(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'kind','RESERVATION_SET','commitment','PROPOSED','order',payload));
 INSERT INTO master_wok_event_test.booking_commands VALUES(p_stream,p_request,cmd);
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.create_delivery_booking(uuid,text,uuid,text,timestamptz,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.apply_delivery_booking(p_stream uuid,p_request text,p_order uuid,p_action text,p_target timestamptz DEFAULT NULL,p_plan jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; b master_wok_event_test.booking_rows%ROWTYPE; prior jsonb; cmd jsonb; payload jsonb; target timestamptz; event_at timestamptz;
BEGIN
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_stream FOR UPDATE;
 IF NOT s.enabled OR s.scope<>'SYNTHETIC_STAGING_EVENTS' THEN RAISE EXCEPTION 'SOURCE_DISABLED'; END IF;
 IF coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR coalesce(p_action,'') NOT IN ('offer','confirm') OR (p_action='offer')<>(p_target IS NOT NULL) THEN RAISE EXCEPTION 'DELIVERY_COMMAND_REQUIRED'; END IF;
 cmd:=jsonb_build_object('orderId',p_order,'action',p_action,'target',p_target,'planning',p_plan);
 SELECT command INTO prior FROM master_wok_event_test.booking_commands WHERE stream_id=p_stream AND request_id=p_request;
 IF FOUND THEN
  IF prior=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 SELECT * INTO STRICT b FROM master_wok_event_test.booking_rows WHERE stream_id=p_stream AND id=p_order FOR UPDATE;
 IF b.order_type<>'delivery' THEN RAISE EXCEPTION 'DELIVERY_ORDER_REQUIRED'; END IF;
 IF b.status IN ('cancelled','completed') THEN RAISE EXCEPTION 'TERMINAL_ORDER'; END IF;
 IF p_action='confirm' AND b.status='customer_declined_time' THEN RAISE EXCEPTION 'NEW_OFFER_REQUIRED'; END IF;
 target:=CASE WHEN p_action='offer' THEN p_target ELSE coalesce(b.proposed_time,b.confirmed_time,b.preferred_time) END;
 payload:=master_wok_event_test.booking_payload(p_stream,p_order,target);event_at:=clock_timestamp();
 payload:=payload||jsonb_build_object('deliveryReadyEstimate',master_wok_event_test.delivery_plan_estimate(payload,p_request,p_plan,event_at));
 PERFORM master_wok_event_test.record(p_stream,jsonb_build_object('eventId',p_request,'at',to_char(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'kind','BOOKING_DECISION','actualDecision',CASE p_action WHEN 'offer' THEN 'SUGGESTED' ELSE 'ACCEPTED' END,'order',payload));
 UPDATE master_wok_event_test.booking_rows SET status=CASE p_action WHEN 'offer' THEN 'proposed' ELSE 'confirmed' END,
  proposed_time=CASE WHEN p_action='offer' THEN target ELSE proposed_time END,
  confirmed_time=CASE WHEN p_action='confirm' THEN target ELSE NULL END,
  current_proposal_event_id=CASE WHEN p_action='offer' THEN p_request ELSE NULL END
 WHERE stream_id=p_stream AND id=p_order;
 INSERT INTO master_wok_event_test.booking_commands VALUES(p_stream,p_request,cmd);
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.apply_delivery_booking(uuid,text,uuid,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
