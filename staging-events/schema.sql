-- STAGING ONLY: hvrqgufqjslvgiohgkvu. Private synthetic backend; no public.orders hooks.
CREATE SCHEMA master_wok_event_test;
REVOKE ALL ON SCHEMA master_wok_event_test FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE master_wok_event_test.streams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 service_date date NOT NULL,
 scope text NOT NULL DEFAULT 'SYNTHETIC_STAGING_EVENTS' CHECK(scope='SYNTHETIC_STAGING_EVENTS'),
 enabled boolean NOT NULL DEFAULT false,
 event_count integer NOT NULL DEFAULT 0 CHECK(event_count BETWEEN 0 AND 1000),
 last_at timestamptz,
 CHECK ((event_count=0)=(last_at IS NULL))
);
CREATE TABLE master_wok_event_test.events (
 stream_id uuid NOT NULL REFERENCES master_wok_event_test.streams(id),
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 1000),
 event_id text NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(stream_id,sequence), UNIQUE(stream_id,event_id)
);
CREATE TABLE master_wok_event_test.reservations (
 stream_id uuid NOT NULL REFERENCES master_wok_event_test.streams(id),
 order_id text NOT NULL CHECK(order_id ~ '^synthetic-[a-z0-9_-]{1,80}$'),
 commitment text NOT NULL CHECK(commitment IN ('PROPOSED','CONFIRMED')),
 proposal_event_id text,
 order_payload jsonb NOT NULL,
 PRIMARY KEY(stream_id,order_id)
);
ALTER TABLE master_wok_event_test.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA master_wok_event_test FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.record(p_stream uuid,p_event jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; old jsonb; e jsonb; oid text; k text; t timestamptz;
 r master_wok_event_test.reservations%ROWTYPE; expected_keys text[]; actual_keys text[];
BEGIN
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_stream FOR UPDATE;
 IF NOT s.enabled THEN RAISE EXCEPTION 'SOURCE_DISABLED'; END IF;
 IF jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR p_event ? 'sequence' THEN RAISE EXCEPTION 'SOURCE_EVENT_REQUIRED'; END IF;
 SELECT payload INTO old FROM master_wok_event_test.events WHERE stream_id=p_stream AND event_id=p_event->>'eventId';
 IF FOUND THEN
  IF old-'sequence'=p_event THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'EVENT_ID_REUSED';
 END IF;
 k:=p_event->>'kind';
 IF k='RESERVATION_SET' THEN expected_keys:=ARRAY['eventId','at','kind','order','commitment'];
 ELSIF k='BOOKING_DECISION' THEN expected_keys:=ARRAY['eventId','at','kind','order','actualDecision'];
 ELSIF k='RESERVATION_RELEASED' THEN expected_keys:=ARRAY['eventId','at','kind','orderId','reason'];
 ELSIF k='ORDER_STATE_CHANGED' THEN expected_keys:=ARRAY['eventId','at','kind','orderId','status'];
 ELSIF k='PROPOSAL_RESPONSE' THEN expected_keys:=ARRAY['eventId','at','kind','orderId','proposalEventId','response'];
 ELSE RAISE EXCEPTION 'EVENT_KIND_REQUIRED'; END IF;
 SELECT array_agg(x ORDER BY x) INTO actual_keys FROM jsonb_object_keys(p_event) x;
 SELECT array_agg(x ORDER BY x) INTO expected_keys FROM unnest(expected_keys) x;
 IF actual_keys IS DISTINCT FROM expected_keys OR coalesce(p_event->>'eventId','') !~ '^[a-zA-Z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'EVENT_SHAPE_REQUIRED'; END IF;
 IF coalesce(p_event->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'EVENT_TIME_REQUIRED'; END IF;
 t:=(p_event->>'at')::timestamptz;
 IF t< s.last_at OR t>clock_timestamp() OR (t AT TIME ZONE 'Europe/London')::date>s.service_date THEN RAISE EXCEPTION 'EVENT_TIME_UNVERIFIED'; END IF;
 oid:=coalesce(p_event->>'orderId',p_event->'order'->>'orderId');
 IF coalesce(oid,'') !~ '^synthetic-[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'SYNTHETIC_ORDER_REQUIRED'; END IF;
 IF k IN ('RESERVATION_SET','BOOKING_DECISION') THEN
  IF jsonb_typeof(p_event->'order') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ORDER_REQUIRED'; END IF;
  SELECT array_agg(x ORDER BY x) INTO actual_keys FROM jsonb_object_keys(p_event->'order') x;
  IF actual_keys IS DISTINCT FROM ARRAY['deliveryReadyEstimate','lines','orderId','orderType','targetAt'] OR
   coalesce(p_event->'order'->>'orderType','') NOT IN ('collection','delivery') OR
   jsonb_typeof(p_event->'order'->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ORDER_REQUIRED'; END IF;
  IF jsonb_array_length(p_event->'order'->'lines') NOT BETWEEN 1 AND 100 OR
   ((p_event->'order'->>'targetAt')::timestamptz AT TIME ZONE 'Europe/London')::date IS DISTINCT FROM s.service_date THEN RAISE EXCEPTION 'ORDER_TARGET_REQUIRED'; END IF;
 END IF;
 IF s.event_count>=1000 OR pg_column_size(p_event)>100000 THEN RAISE EXCEPTION 'SOURCE_LIMIT'; END IF;
 SELECT * INTO r FROM master_wok_event_test.reservations WHERE stream_id=p_stream AND order_id=oid;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id=p_stream AND coalesce(payload->>'orderId',payload->'order'->>'orderId')=oid AND payload->>'kind' IN ('ORDER_STATE_CHANGED','RESERVATION_RELEASED')) THEN RAISE EXCEPTION 'ORDER_ALREADY_CLOSED'; END IF;
 IF k='ORDER_STATE_CHANGED' THEN
  IF coalesce(p_event->>'status','') NOT IN ('CANCELLED','COMPLETED') OR r.order_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id=p_stream AND coalesce(payload->>'orderId',payload->'order'->>'orderId')=oid) THEN RAISE EXCEPTION 'ORDER_STATE_CHANGE_REQUIRED'; END IF;
 ELSIF k='PROPOSAL_RESPONSE' THEN
  IF r.commitment IS DISTINCT FROM 'PROPOSED' OR r.proposal_event_id IS DISTINCT FROM p_event->>'proposalEventId' THEN RAISE EXCEPTION 'STALE_PROPOSAL_RESPONSE'; END IF;
  IF p_event->>'response'='ACCEPTED' THEN
   UPDATE master_wok_event_test.reservations SET commitment='CONFIRMED',proposal_event_id=NULL WHERE stream_id=p_stream AND order_id=oid;
  ELSIF p_event->>'response'='REJECTED' THEN DELETE FROM master_wok_event_test.reservations WHERE stream_id=p_stream AND order_id=oid;
  ELSE RAISE EXCEPTION 'RESPONSE_REQUIRED'; END IF;
 ELSIF k='RESERVATION_RELEASED' THEN
  IF coalesce(p_event->>'reason','') NOT IN ('CANCELLED','COMPLETED') OR r.order_id IS NULL THEN RAISE EXCEPTION 'RELEASE_REQUIRED'; END IF;
  DELETE FROM master_wok_event_test.reservations WHERE stream_id=p_stream AND order_id=oid;
 ELSE
  IF k='RESERVATION_SET' AND coalesce(p_event->>'commitment','') NOT IN ('PROPOSED','CONFIRMED') OR
   k='BOOKING_DECISION' AND coalesce(p_event->>'actualDecision','') NOT IN ('ACCEPTED','DECLINED','SUGGESTED') THEN RAISE EXCEPTION 'DECISION_REQUIRED'; END IF;
  IF coalesce(p_event->>'actualDecision','')<>'DECLINED' THEN
   INSERT INTO master_wok_event_test.reservations VALUES(p_stream,oid,
    CASE WHEN p_event->>'commitment'='PROPOSED' OR p_event->>'actualDecision'='SUGGESTED' THEN 'PROPOSED' ELSE 'CONFIRMED' END,
    CASE WHEN p_event->>'commitment'='PROPOSED' OR p_event->>'actualDecision'='SUGGESTED' THEN p_event->>'eventId' ELSE NULL END,p_event->'order')
   ON CONFLICT(stream_id,order_id) DO UPDATE SET commitment=excluded.commitment,proposal_event_id=excluded.proposal_event_id,order_payload=excluded.order_payload;
  END IF;
 END IF;
 e:=p_event||jsonb_build_object('sequence',s.event_count+1);
 INSERT INTO master_wok_event_test.events VALUES(p_stream,s.event_count+1,p_event->>'eventId',e);
 UPDATE master_wok_event_test.streams SET event_count=event_count+1,last_at=t WHERE id=p_stream;
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.record(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.export(p_stream uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
 SELECT jsonb_build_object('serviceDate',s.service_date::text,'coverage',jsonb_build_object(
  'basis','DECISION_EVENT_LOG','complete',true,'eventCount',s.event_count,'firstSequence',1,
  'lastSequence',s.event_count,'initialState','NO_PRIOR_SERVICE_COMMITMENTS',
  'throughAt',to_char(s.last_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  'events',(SELECT coalesce(jsonb_agg(e.payload ORDER BY e.sequence),'[]'::jsonb) FROM master_wok_event_test.events e WHERE e.stream_id=s.id))
 FROM master_wok_event_test.streams s WHERE s.id=p_stream AND s.event_count>0;
$$;
REVOKE ALL ON FUNCTION master_wok_event_test.export(uuid) FROM PUBLIC,anon,authenticated,service_role;
