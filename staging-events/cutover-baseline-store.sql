-- Private synthetic staging candidate. No grants, public tables or production hooks.
-- Every participating writer MUST lock its stream before touching bookings/items.
-- Run with cutover-record-export.sql in the same transaction. NOT a production migration.
CREATE FUNCTION master_wok_event_test.seed_cutover_baseline(p_source uuid,p_destination uuid,p_request text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE estimate jsonb; stamp_text text; arrival timestamptz; ready timestamptz;
 s master_wok_event_test.streams%ROWTYPE; d master_wok_event_test.streams%ROWTYPE;
 b master_wok_event_test.booking_rows%ROWTYPE; r master_wok_event_test.reservations%ROWTYPE;
 cmd jsonb; prior jsonb; expected jsonb; held jsonb:='[]'; unreserved jsonb:='[]'; e jsonb;
 cutover_at timestamptz; target timestamptz; item record; modifier jsonb; keys text[];
BEGIN
 IF p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR
  coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'CUTOVER_COMMAND_REQUIRED'; END IF;
 -- The same UUID order used by cross-date moves prevents opposed cutover deadlocks.
 PERFORM 1 FROM master_wok_event_test.streams WHERE id IN (p_source,p_destination) ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_source;
 SELECT * INTO STRICT d FROM master_wok_event_test.streams WHERE id=p_destination;
 cmd:=jsonb_build_object('action','cutover','source',p_source,'destination',p_destination);
 SELECT command INTO prior FROM master_wok_event_test.booking_commands WHERE stream_id=p_destination AND request_id=p_request;
 IF FOUND THEN
  IF prior=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 IF NOT s.enabled OR NOT d.enabled OR s.scope<>'SYNTHETIC_STAGING_EVENTS' OR d.scope<>s.scope OR
  s.service_date<>d.service_date THEN RAISE EXCEPTION 'CUTOVER_SCOPE_REQUIRED'; END IF;
 IF d.event_count<>0 OR EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id=p_destination) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_rows WHERE stream_id=p_destination) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_commands WHERE stream_id=p_destination) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.reservations WHERE stream_id=p_destination) THEN RAISE EXCEPTION 'EMPTY_DESTINATION_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.booking_commands WHERE stream_id=p_source AND request_id=p_request) THEN RAISE EXCEPTION 'REQUEST_ID_REUSED'; END IF;
 -- A single-stream switch cannot establish closure of a connected transfer history.
 IF EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id=p_source AND payload->>'kind' IN ('RESERVATION_TRANSFERRED_IN','RESERVATION_TRANSFERRED_OUT')) THEN RAISE EXCEPTION 'CONNECTED_CUTOVER_REQUIRED'; END IF;
 IF (SELECT count(*) FROM master_wok_event_test.booking_rows WHERE stream_id=p_source)>1000 OR
  (SELECT count(*) FROM master_wok_event_test.reservations WHERE stream_id=p_source)>500 THEN RAISE EXCEPTION 'CUTOVER_BOUND_EXCEEDED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.reservations held_row WHERE held_row.stream_id=p_source AND NOT EXISTS(
  SELECT 1 FROM master_wok_event_test.booking_rows booking_row WHERE booking_row.stream_id=p_source AND booking_row.order_alias=held_row.order_id)) THEN RAISE EXCEPTION 'ORPHAN_RESERVATION'; END IF;
 FOR b IN SELECT * FROM master_wok_event_test.booking_rows WHERE stream_id=p_source ORDER BY order_alias LOOP
  SELECT * INTO r FROM master_wok_event_test.reservations WHERE stream_id=p_source AND order_id=b.order_alias;
  IF b.status NOT IN ('pending','proposed','confirmed','customer_accepted_time','customer_declined_time','cancelled','completed') THEN RAISE EXCEPTION 'CUTOVER_STATUS_UNVERIFIED'; END IF;
  IF (b.status IN ('pending','proposed','confirmed','customer_accepted_time'))<>(r.order_id IS NOT NULL) THEN RAISE EXCEPTION 'RESERVATION_STATE_MISMATCH'; END IF;
  IF b.status IN ('cancelled','completed') THEN CONTINUE; END IF;
  FOR item IN SELECT * FROM master_wok_event_test.booking_items WHERE stream_id=p_source AND order_id=b.id LOOP
   IF jsonb_array_length(item.modifiers)>30 THEN RAISE EXCEPTION 'MODIFIER_REQUIRED'; END IF;
   FOR modifier IN SELECT value FROM jsonb_array_elements(item.modifiers) LOOP
    IF jsonb_typeof(modifier) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MODIFIER_REQUIRED'; END IF;
    SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(modifier) k;
    IF keys IS DISTINCT FROM ARRAY['id'] OR jsonb_typeof(modifier->'id') IS DISTINCT FROM 'string' OR coalesce(modifier->>'id','') !~ '^[a-z0-9-]{1,80}$' THEN RAISE EXCEPTION 'MODIFIER_REQUIRED'; END IF;
   END LOOP;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM master_wok_event_test.booking_items WHERE stream_id=p_source AND order_id=b.id) THEN RAISE EXCEPTION 'COMPLETE_BASKET_REQUIRED'; END IF;
  IF r.order_id IS NULL THEN
   unreserved:=unreserved||jsonb_build_array(b.order_alias);
   CONTINUE;
  END IF;
  target:=CASE b.status WHEN 'pending' THEN b.preferred_time WHEN 'proposed' THEN b.proposed_time ELSE b.confirmed_time END;
  IF target IS NULL OR (target AT TIME ZONE 'Europe/London')::date<>s.service_date OR
   (target AT TIME ZONE 'Europe/London')::time NOT BETWEEN time '16:30' AND time '22:00' OR
   (b.status IN ('pending','proposed'))<>(r.commitment='PROPOSED') OR
   (r.commitment='CONFIRMED' AND (r.proposal_event_id IS NOT NULL OR b.current_proposal_event_id IS NOT NULL)) OR
   (r.commitment='PROPOSED' AND (coalesce(r.proposal_event_id,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR r.proposal_event_id=p_request)) OR
   (b.status='proposed' AND b.current_proposal_event_id IS DISTINCT FROM r.proposal_event_id) OR
   (b.status='pending' AND b.current_proposal_event_id IS NOT NULL) THEN RAISE EXCEPTION 'CUTOVER_REVISION_UNVERIFIED'; END IF;
  expected:=master_wok_event_test.booking_payload(p_source,b.id,target);
  IF r.order_payload - 'deliveryReadyEstimate' IS DISTINCT FROM expected - 'deliveryReadyEstimate' OR
   NOT (r.order_payload ? 'deliveryReadyEstimate') THEN RAISE EXCEPTION 'COMPLETE_RESERVATION_PAYLOAD_REQUIRED'; END IF;
  IF r.order_payload->'deliveryReadyEstimate'<>'null'::jsonb THEN
   IF b.order_type<>'delivery' OR jsonb_typeof(r.order_payload->'deliveryReadyEstimate') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DELIVERY_ESTIMATE_REQUIRED'; END IF;
   SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(r.order_payload->'deliveryReadyEstimate') k;
   IF keys IS DISTINCT FROM ARRAY['arrivalAt','basis','estimatedAt','foodReadyAt'] AND keys IS DISTINCT FROM ARRAY['basis','estimatedAt','foodReadyAt'] OR
    r.order_payload->'deliveryReadyEstimate'->>'basis' IS DISTINCT FROM 'DELIVERY_PLANNER_ESTIMATE' THEN RAISE EXCEPTION 'DELIVERY_ESTIMATE_REQUIRED'; END IF;
   estimate:=r.order_payload->'deliveryReadyEstimate';
   FOREACH stamp_text IN ARRAY ARRAY[estimate->>'foodReadyAt',estimate->>'estimatedAt',coalesce(estimate->>'arrivalAt',r.order_payload->>'targetAt')] LOOP
    IF coalesce(stamp_text,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'DELIVERY_ESTIMATE_REQUIRED'; END IF;
    PERFORM stamp_text::timestamptz;
   END LOOP;
   arrival:=coalesce(estimate->>'arrivalAt',r.order_payload->>'targetAt')::timestamptz;
   ready:=(estimate->>'foodReadyAt')::timestamptz;
   IF (estimate->>'estimatedAt')::timestamptz>clock_timestamp() OR ready>=arrival OR
    (ready AT TIME ZONE 'Europe/London')::date<>s.service_date OR
    (arrival AT TIME ZONE 'Europe/London')::date<>s.service_date OR abs(extract(epoch FROM arrival-target))>600 THEN RAISE EXCEPTION 'DELIVERY_ESTIMATE_REQUIRED'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(held) h WHERE h->>'proposalEventId'=r.proposal_event_id) THEN RAISE EXCEPTION 'DUPLICATE_PROPOSAL_REVISION'; END IF;
  held:=held||jsonb_build_array(jsonb_build_object('order',r.order_payload,'commitment',r.commitment,'proposalEventId',r.proposal_event_id));
 END LOOP;
 cutover_at:=clock_timestamp();
 IF (cutover_at AT TIME ZONE 'Europe/London')::date>s.service_date OR cutover_at<s.last_at THEN RAISE EXCEPTION 'CUTOVER_TIME_UNVERIFIED'; END IF;
 e:=jsonb_build_object('eventId',p_request,'sequence',1,'at',to_char(cutover_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'kind','CUTOVER_BASELINE','basis','CURRENT_SAVED_STATE_AT_CUTOVER','commitments',held,'unreservedOrderIds',unreserved);
 IF octet_length(e::text)>100000 THEN RAISE EXCEPTION 'CUTOVER_BOUND_EXCEEDED'; END IF;
 INSERT INTO master_wok_event_test.booking_rows(stream_id,id,order_alias,created_at,status,order_type,preferred_time,proposed_time,confirmed_time,current_proposal_event_id) SELECT p_destination,id,order_alias,created_at,status,order_type,preferred_time,proposed_time,confirmed_time,current_proposal_event_id FROM master_wok_event_test.booking_rows WHERE stream_id=p_source;
 INSERT INTO master_wok_event_test.booking_items(stream_id,order_id,line_no,item_id,qty,modifiers) SELECT p_destination,order_id,line_no,item_id,qty,modifiers FROM master_wok_event_test.booking_items WHERE stream_id=p_source;
 -- Preserve receipts so retries of pre-cutover commands cannot consume capacity twice.
 INSERT INTO master_wok_event_test.booking_commands(stream_id,request_id,command) SELECT p_destination,request_id,command FROM master_wok_event_test.booking_commands WHERE stream_id=p_source;
 INSERT INTO master_wok_event_test.reservations(stream_id,order_id,commitment,proposal_event_id,order_payload) SELECT p_destination,order_id,commitment,proposal_event_id,order_payload FROM master_wok_event_test.reservations WHERE stream_id=p_source;
 INSERT INTO master_wok_event_test.events VALUES(p_destination,1,p_request,e);
 INSERT INTO master_wok_event_test.booking_commands VALUES(p_destination,p_request,cmd);
 UPDATE master_wok_event_test.streams SET event_count=1,last_at=cutover_at WHERE id=p_destination;
 -- Historical projection stays frozen; only the destination remains writable.
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id=p_source;
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.seed_cutover_baseline(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
