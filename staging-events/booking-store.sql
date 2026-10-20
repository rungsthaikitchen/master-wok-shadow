-- Private synthetic staging adaptation. No public tables, triggers or grants.
CREATE TABLE master_wok_event_test.booking_rows (
 stream_id uuid NOT NULL REFERENCES master_wok_event_test.streams(id),
 id uuid NOT NULL, order_alias text NOT NULL CHECK(order_alias ~ '^synthetic-[a-z0-9_-]{1,80}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'pending', order_type text NOT NULL CHECK(order_type='collection'),
 preferred_time timestamptz NOT NULL, proposed_time timestamptz, confirmed_time timestamptz,
 current_proposal_event_id text,
 PRIMARY KEY(stream_id,id), UNIQUE(stream_id,order_alias)
);
CREATE TABLE master_wok_event_test.booking_items (
 stream_id uuid NOT NULL, order_id uuid NOT NULL, line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 100),
 item_id text NOT NULL CHECK(item_id ~ '^[a-z0-9-]{1,80}$'), qty integer NOT NULL CHECK(qty BETWEEN 1 AND 100),
 modifiers jsonb NOT NULL CHECK(jsonb_typeof(modifiers)='array'),
 PRIMARY KEY(stream_id,order_id,line_no),
 FOREIGN KEY(stream_id,order_id) REFERENCES master_wok_event_test.booking_rows(stream_id,id)
);
CREATE TABLE master_wok_event_test.booking_commands (
 stream_id uuid NOT NULL REFERENCES master_wok_event_test.streams(id), request_id text NOT NULL,
 command jsonb NOT NULL, PRIMARY KEY(stream_id,request_id)
);
ALTER TABLE master_wok_event_test.booking_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.booking_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.booking_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_wok_event_test.booking_rows,master_wok_event_test.booking_items,master_wok_event_test.booking_commands FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.booking_payload(p_stream uuid,p_order uuid,p_target timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
 SELECT jsonb_build_object('orderId',b.order_alias,'orderType',b.order_type,
  'targetAt',to_char(p_target AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'deliveryReadyEstimate',NULL,'lines',(SELECT jsonb_agg(jsonb_build_object('itemId',i.item_id,'qty',i.qty,'mods',i.modifiers) ORDER BY i.line_no)
   FROM master_wok_event_test.booking_items i WHERE i.stream_id=b.stream_id AND i.order_id=b.id))
 FROM master_wok_event_test.booking_rows b WHERE b.stream_id=p_stream AND b.id=p_order;
$$;
REVOKE ALL ON FUNCTION master_wok_event_test.booking_payload(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.create_booking(p_stream uuid,p_request text,p_order uuid,p_alias text,p_preferred timestamptz,p_lines jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; cmd jsonb; prior jsonb; line jsonb; keys text[]; n integer:=0; payload jsonb;
BEGIN
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_stream FOR UPDATE;
 IF NOT s.enabled OR s.scope<>'SYNTHETIC_STAGING_EVENTS' THEN RAISE EXCEPTION 'SOURCE_DISABLED'; END IF;
 IF coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR p_order IS NULL OR p_preferred IS NULL THEN RAISE EXCEPTION 'CREATE_COMMAND_REQUIRED'; END IF;
 cmd:=jsonb_build_object('action','create','orderId',p_order,'alias',p_alias,'preferred',p_preferred,'lines',p_lines);
 SELECT command INTO prior FROM master_wok_event_test.booking_commands WHERE stream_id=p_stream AND request_id=p_request;
 IF FOUND THEN
  IF prior=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'COMPLETE_BASKET_REQUIRED'; END IF;
 INSERT INTO master_wok_event_test.booking_rows(stream_id,id,order_alias,order_type,preferred_time) VALUES(p_stream,p_order,p_alias,'collection',p_preferred);
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
 PERFORM master_wok_event_test.record(p_stream,jsonb_build_object('eventId',p_request,'at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'kind','RESERVATION_SET','commitment','PROPOSED','order',payload));
 INSERT INTO master_wok_event_test.booking_commands VALUES(p_stream,p_request,cmd);
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.create_booking(uuid,text,uuid,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.apply_booking(p_stream uuid,p_request text,p_order uuid,p_action text,p_target timestamptz DEFAULT NULL,p_proposal text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; b master_wok_event_test.booking_rows%ROWTYPE; prior jsonb; cmd jsonb; e jsonb; target timestamptz;
BEGIN
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_stream FOR UPDATE;
 IF NOT s.enabled OR s.scope<>'SYNTHETIC_STAGING_EVENTS' THEN RAISE EXCEPTION 'SOURCE_DISABLED'; END IF;
 IF coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR coalesce(p_action,'') NOT IN ('offer','confirm','accept','reject','cancel','complete') THEN RAISE EXCEPTION 'BOOKING_COMMAND_REQUIRED'; END IF;
 cmd:=jsonb_build_object('orderId',p_order,'action',p_action,'target',p_target,'proposal',p_proposal);
 SELECT command INTO prior FROM master_wok_event_test.booking_commands WHERE stream_id=p_stream AND request_id=p_request;
 IF FOUND THEN
  IF prior=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 SELECT * INTO STRICT b FROM master_wok_event_test.booking_rows WHERE stream_id=p_stream AND id=p_order FOR UPDATE;
 IF b.status IN ('cancelled','completed') THEN RAISE EXCEPTION 'TERMINAL_ORDER'; END IF;
 IF (p_action='offer')<>(p_target IS NOT NULL) OR (p_action IN ('accept','reject'))<>(p_proposal IS NOT NULL) THEN RAISE EXCEPTION 'COMMAND_FIELDS_REFUSED'; END IF;
 e:=jsonb_build_object('eventId',p_request,'at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 IF p_action IN ('offer','confirm') THEN
  target:=CASE WHEN p_action='offer' THEN p_target ELSE coalesce(b.proposed_time,b.confirmed_time,b.preferred_time) END;
  IF p_action='confirm' AND b.status='customer_declined_time' THEN RAISE EXCEPTION 'NEW_OFFER_REQUIRED'; END IF;
  e:=e||jsonb_build_object('kind','BOOKING_DECISION','actualDecision',CASE p_action WHEN 'offer' THEN 'SUGGESTED' ELSE 'ACCEPTED' END,'order',master_wok_event_test.booking_payload(p_stream,p_order,target));
 ELSIF p_action IN ('accept','reject') THEN
  IF b.status<>'proposed' OR b.current_proposal_event_id IS DISTINCT FROM p_proposal THEN RAISE EXCEPTION 'STALE_PROPOSAL_RESPONSE'; END IF;
  e:=e||jsonb_build_object('kind','PROPOSAL_RESPONSE','orderId',b.order_alias,'proposalEventId',p_proposal,'response',CASE p_action WHEN 'accept' THEN 'ACCEPTED' ELSE 'REJECTED' END);
 ELSE
  IF EXISTS(SELECT 1 FROM master_wok_event_test.reservations WHERE stream_id=p_stream AND order_id=b.order_alias) THEN
   e:=e||jsonb_build_object('kind','RESERVATION_RELEASED','orderId',b.order_alias,'reason',CASE p_action WHEN 'cancel' THEN 'CANCELLED' ELSE 'COMPLETED' END);
  ELSE
   e:=e||jsonb_build_object('kind','ORDER_STATE_CHANGED','orderId',b.order_alias,'status',CASE p_action WHEN 'cancel' THEN 'CANCELLED' ELSE 'COMPLETED' END);
  END IF;
 END IF;
 PERFORM master_wok_event_test.record(p_stream,e);
 UPDATE master_wok_event_test.booking_rows SET
  status=CASE p_action WHEN 'offer' THEN 'proposed' WHEN 'confirm' THEN 'confirmed' WHEN 'accept' THEN 'customer_accepted_time' WHEN 'reject' THEN 'customer_declined_time' WHEN 'cancel' THEN 'cancelled' ELSE 'completed' END,
  proposed_time=CASE WHEN p_action='offer' THEN p_target ELSE proposed_time END,
  confirmed_time=CASE WHEN p_action IN ('offer','reject') THEN NULL WHEN p_action='accept' THEN proposed_time WHEN p_action='confirm' THEN target ELSE confirmed_time END,
  current_proposal_event_id=CASE WHEN p_action='offer' THEN p_request ELSE NULL END
 WHERE stream_id=p_stream AND id=p_order;
 INSERT INTO master_wok_event_test.booking_commands VALUES(p_stream,p_request,cmd);
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.apply_booking(uuid,text,uuid,text,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
