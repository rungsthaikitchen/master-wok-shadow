-- Private synthetic candidate helper. VOLATILE deliberately keeps fresh snapshots after lock waits.
-- All stream locks must be acquired in UUID order by the seeding caller first.
CREATE FUNCTION master_wok_event_test.cutover_snapshot(p_source uuid,p_request text,p_at timestamptz,p_allow_moved boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE estimate jsonb; stamp_text text; arrival timestamptz; ready timestamptz;
 s master_wok_event_test.streams%ROWTYPE;
 b master_wok_event_test.booking_rows%ROWTYPE; r master_wok_event_test.reservations%ROWTYPE;
 expected jsonb; held jsonb:='[]'; unreserved jsonb:='[]'; e jsonb;
 target timestamptz; item record; modifier jsonb; keys text[];
BEGIN
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_source FOR UPDATE;
 IF NOT s.enabled OR s.scope<>'SYNTHETIC_STAGING_EVENTS' OR p_at IS NULL OR p_at>clock_timestamp() OR
  coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR p_allow_moved IS NULL THEN RAISE EXCEPTION 'CUTOVER_SCOPE_REQUIRED'; END IF;
 IF (SELECT count(*) FROM master_wok_event_test.booking_rows WHERE stream_id=p_source)>1000 OR
  (SELECT count(*) FROM master_wok_event_test.reservations WHERE stream_id=p_source)>500 THEN RAISE EXCEPTION 'CUTOVER_BOUND_EXCEEDED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.reservations held_row WHERE held_row.stream_id=p_source AND NOT EXISTS(
  SELECT 1 FROM master_wok_event_test.booking_rows booking_row WHERE booking_row.stream_id=p_source AND booking_row.order_alias=held_row.order_id)) THEN RAISE EXCEPTION 'ORPHAN_RESERVATION'; END IF;
 FOR b IN SELECT * FROM master_wok_event_test.booking_rows WHERE stream_id=p_source ORDER BY order_alias LOOP
  SELECT * INTO r FROM master_wok_event_test.reservations WHERE stream_id=p_source AND order_id=b.order_alias;
  IF b.status NOT IN ('pending','proposed','confirmed','customer_accepted_time','customer_declined_time','cancelled','completed','moved_service_date') THEN RAISE EXCEPTION 'CUTOVER_STATUS_UNVERIFIED'; END IF;
  IF (b.status IN ('pending','proposed','confirmed','customer_accepted_time'))<>(r.order_id IS NOT NULL) THEN RAISE EXCEPTION 'RESERVATION_STATE_MISMATCH'; END IF;
  IF b.status='moved_service_date' AND NOT p_allow_moved THEN RAISE EXCEPTION 'CUTOVER_STATUS_UNVERIFIED'; END IF;
  IF b.status IN ('cancelled','completed','moved_service_date') THEN CONTINUE; END IF;
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
 IF (p_at AT TIME ZONE 'Europe/London')::date>s.service_date OR p_at<s.last_at THEN RAISE EXCEPTION 'CUTOVER_TIME_UNVERIFIED'; END IF;
 e:=jsonb_build_object('eventId',p_request,'sequence',1,'at',to_char(p_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'kind','CUTOVER_BASELINE','basis','CURRENT_SAVED_STATE_AT_CUTOVER','commitments',held,'unreservedOrderIds',unreserved);
 IF octet_length(e::text)>100000 THEN RAISE EXCEPTION 'CUTOVER_BOUND_EXCEEDED'; END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.cutover_snapshot(uuid,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
