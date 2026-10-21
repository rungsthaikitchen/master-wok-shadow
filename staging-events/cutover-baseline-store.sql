-- Private synthetic staging candidate. No grants, public tables or production hooks.
-- Every participating writer MUST lock its stream before touching bookings/items.
-- Load cutover-baseline-snapshot.sql first; run with cutover-record-export.sql in the same transaction. NOT a production migration.
CREATE OR REPLACE FUNCTION master_wok_event_test.seed_cutover_baseline(p_source uuid,p_destination uuid,p_request text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; d master_wok_event_test.streams%ROWTYPE;
 cmd jsonb; prior jsonb; e jsonb; cutover_at timestamptz;
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
 cutover_at:=clock_timestamp();
 e:=master_wok_event_test.cutover_snapshot(p_source,p_request,cutover_at,false);
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
