-- Private staging candidate. Load with matching record()/booking guard definitions.
-- No runtime grants; all acceptance work runs inside BEGIN/ROLLBACK.
CREATE TABLE master_wok_event_test.booking_transfers (
 request_id text PRIMARY KEY,source_stream uuid NOT NULL REFERENCES master_wok_event_test.streams(id),
 destination_stream uuid NOT NULL REFERENCES master_wok_event_test.streams(id),command jsonb NOT NULL,event_at timestamptz NOT NULL
);
ALTER TABLE master_wok_event_test.booking_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_wok_event_test.booking_transfers FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION master_wok_event_test.move_booking_offer(p_source uuid,p_destination uuid,p_request text,p_order uuid,p_target timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE a master_wok_event_test.streams%ROWTYPE; z master_wok_event_test.streams%ROWTYPE; b master_wok_event_test.booking_rows%ROWTYPE; d master_wok_event_test.booking_rows%ROWTYPE;
 receipt jsonb; cmd jsonb; payload jsonb; ts timestamptz; stamp text; row_exists boolean;
BEGIN
 IF p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,80}$' OR p_order IS NULL OR p_target IS NULL THEN RAISE EXCEPTION 'TRANSFER_COMMAND_REQUIRED'; END IF;
 -- Every two-stream operation locks in UUID order, before touching order rows.
 PERFORM 1 FROM master_wok_event_test.streams WHERE id IN (p_source,p_destination) ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT a FROM master_wok_event_test.streams WHERE id=p_source;
 SELECT * INTO STRICT z FROM master_wok_event_test.streams WHERE id=p_destination;
 IF NOT a.enabled OR NOT z.enabled OR a.scope<>'SYNTHETIC_STAGING_EVENTS' OR z.scope<>'SYNTHETIC_STAGING_EVENTS' THEN RAISE EXCEPTION 'SOURCE_DISABLED'; END IF;
 IF a.service_date=z.service_date OR (p_target AT TIME ZONE 'Europe/London')::date<>z.service_date THEN RAISE EXCEPTION 'TRANSFER_DATE_REQUIRED'; END IF;
 cmd:=jsonb_build_object('source',p_source,'destination',p_destination,'order',p_order,'target',p_target);
 SELECT command INTO receipt FROM master_wok_event_test.booking_transfers WHERE request_id=p_request;
 IF FOUND THEN
  IF receipt=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 SELECT * INTO STRICT b FROM master_wok_event_test.booking_rows WHERE stream_id=p_source AND id=p_order FOR UPDATE;
 IF b.status IN ('cancelled','completed','moved_service_date') OR NOT EXISTS(SELECT FROM master_wok_event_test.reservations WHERE stream_id=p_source AND order_id=b.order_alias) THEN RAISE EXCEPTION 'TRANSFER_RESERVATION_REQUIRED'; END IF;
 SELECT * INTO d FROM master_wok_event_test.booking_rows WHERE stream_id=p_destination AND id=p_order FOR UPDATE;row_exists:=FOUND;
 IF row_exists THEN
  IF d.status<>'moved_service_date' OR d.order_alias<>b.order_alias OR d.order_type<>b.order_type OR
   master_wok_event_test.booking_payload(p_source,p_order,p_target)->'lines' IS DISTINCT FROM master_wok_event_test.booking_payload(p_destination,p_order,p_target)->'lines' THEN RAISE EXCEPTION 'TRANSFER_DESTINATION_OCCUPIED'; END IF;
 ELSE
  INSERT INTO master_wok_event_test.booking_rows(stream_id,id,order_alias,order_type,preferred_time)
   VALUES(p_destination,p_order,b.order_alias,b.order_type,b.preferred_time);
  INSERT INTO master_wok_event_test.booking_items(stream_id,order_id,line_no,item_id,qty,modifiers)
   SELECT p_destination,order_id,line_no,item_id,qty,modifiers FROM master_wok_event_test.booking_items WHERE stream_id=p_source AND order_id=p_order;
 END IF;
 payload:=master_wok_event_test.booking_payload(p_destination,p_order,p_target);
 -- A different service day never inherits a previous day's delivery estimate.
 ts:=clock_timestamp();stamp:=to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 PERFORM master_wok_event_test.record(p_source,jsonb_build_object('eventId',p_request||'_out','at',stamp,'kind','RESERVATION_TRANSFERRED_OUT','orderId',b.order_alias,'transferId',p_request,'toServiceDate',z.service_date::text));
 PERFORM master_wok_event_test.record(p_destination,jsonb_build_object('eventId',p_request||'_in','at',stamp,'kind','RESERVATION_TRANSFERRED_IN','order',payload,'actualDecision','SUGGESTED','transferId',p_request,'fromServiceDate',a.service_date::text));
 UPDATE master_wok_event_test.booking_rows SET status='moved_service_date',current_proposal_event_id=NULL WHERE stream_id=p_source AND id=p_order;
 UPDATE master_wok_event_test.booking_rows SET status='proposed',proposed_time=p_target,confirmed_time=NULL,current_proposal_event_id=p_request||'_in' WHERE stream_id=p_destination AND id=p_order;
 INSERT INTO master_wok_event_test.booking_transfers VALUES(p_request,p_source,p_destination,cmd,ts);
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.move_booking_offer(uuid,uuid,text,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
