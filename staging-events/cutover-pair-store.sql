-- Local private synthetic candidate only. Load matching snapshot/record/booking definitions first.
-- This is an administrative cutover of exactly TWO closed connected service streams.
CREATE OR REPLACE FUNCTION master_wok_event_test.seed_cutover_pair(p_source_a uuid,p_destination_a uuid,p_source_b uuid,p_destination_b uuid,p_request text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE sources uuid[]:=ARRAY[p_source_a,p_source_b]; destinations uuid[]:=ARRAY[p_destination_a,p_destination_b];
 all_ids uuid[]:=ARRAY[p_source_a,p_destination_a,p_source_b,p_destination_b]; maps jsonb; cmd jsonb;
 mapping jsonb; src uuid; dst uuid; prior_count integer; ordinal integer:=0;
 cutover_at timestamptz; baseline jsonb; event_id text;
BEGIN
 IF p_source_a IS NULL OR p_source_b IS NULL OR p_destination_a IS NULL OR p_destination_b IS NULL OR
  (SELECT count(DISTINCT x) FROM unnest(all_ids) x)<>4 OR coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'CUTOVER_PAIR_COMMAND_REQUIRED'; END IF;
 -- Canonical mapping makes retries independent of argument pair order.
 SELECT jsonb_agg(jsonb_build_object('source',s,'destination',d) ORDER BY s) INTO maps
 FROM (VALUES(p_source_a,p_destination_a),(p_source_b,p_destination_b)) m(s,d);
 cmd:=jsonb_build_object('action','cutover_pair','mappings',maps);
 -- All four stream locks precede any row, item, receipt or reservation mutation.
 PERFORM 1 FROM master_wok_event_test.streams WHERE id=ANY(all_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM master_wok_event_test.streams WHERE id=ANY(all_ids))<>4 THEN RAISE EXCEPTION 'FOUR_CUTOVER_STREAMS_REQUIRED'; END IF;
 SELECT count(*) INTO prior_count FROM master_wok_event_test.booking_commands WHERE stream_id=ANY(destinations) AND request_id=p_request;
 IF prior_count>0 THEN
  IF prior_count=2 AND NOT EXISTS(SELECT 1 FROM master_wok_event_test.booking_commands WHERE stream_id=ANY(destinations) AND request_id=p_request AND command IS DISTINCT FROM cmd) THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'REQUEST_ID_REUSED';
 END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.streams WHERE id=ANY(all_ids) AND (NOT enabled OR scope<>'SYNTHETIC_STAGING_EVENTS')) OR
  (SELECT count(DISTINCT service_date) FROM master_wok_event_test.streams WHERE id=ANY(sources))<>2 OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(maps) m JOIN master_wok_event_test.streams s ON s.id=(m->>'source')::uuid JOIN master_wok_event_test.streams d ON d.id=(m->>'destination')::uuid WHERE s.service_date<>d.service_date) THEN RAISE EXCEPTION 'CUTOVER_PAIR_SCOPE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.streams WHERE id=ANY(destinations) AND event_count<>0) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id=ANY(destinations)) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_rows WHERE stream_id=ANY(destinations)) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_items WHERE stream_id=ANY(destinations)) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_commands WHERE stream_id=ANY(destinations)) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.reservations WHERE stream_id=ANY(destinations)) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_transfers WHERE source_stream=ANY(destinations) OR destination_stream=ANY(destinations)) THEN RAISE EXCEPTION 'EMPTY_DESTINATION_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.booking_commands WHERE stream_id=ANY(sources) AND request_id=p_request) THEN RAISE EXCEPTION 'REQUEST_ID_REUSED'; END IF;
 -- Disabled/out-of-pair counterpart streams cannot be hidden by cutting only two days.
 IF EXISTS(SELECT 1 FROM master_wok_event_test.booking_transfers WHERE (source_stream=ANY(sources) OR destination_stream=ANY(sources)) AND NOT(source_stream=ANY(sources) AND destination_stream=ANY(sources))) THEN RAISE EXCEPTION 'TRANSFER_CLOSURE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.events e WHERE e.stream_id=ANY(sources) AND e.payload->>'kind' IN ('RESERVATION_TRANSFERRED_IN','RESERVATION_TRANSFERRED_OUT') AND NOT EXISTS(
  SELECT 1 FROM master_wok_event_test.booking_transfers receipt WHERE receipt.request_id=e.payload->>'transferId' AND
   (e.payload->>'kind'='RESERVATION_TRANSFERRED_OUT' AND receipt.source_stream=e.stream_id OR e.payload->>'kind'='RESERVATION_TRANSFERRED_IN' AND receipt.destination_stream=e.stream_id)
 )) OR EXISTS(SELECT 1 FROM master_wok_event_test.booking_transfers receipt WHERE receipt.source_stream=ANY(sources) AND
  (NOT EXISTS(SELECT 1 FROM master_wok_event_test.events e WHERE e.stream_id=receipt.source_stream AND e.event_id=receipt.request_id||'_out' AND e.payload->>'transferId'=receipt.request_id AND e.payload->>'kind'='RESERVATION_TRANSFERRED_OUT') OR
   NOT EXISTS(SELECT 1 FROM master_wok_event_test.events e WHERE e.stream_id=receipt.destination_stream AND e.event_id=receipt.request_id||'_in' AND e.payload->>'transferId'=receipt.request_id AND e.payload->>'kind'='RESERVATION_TRANSFERRED_IN'))) THEN RAISE EXCEPTION 'CUTOVER_TRANSFER_HISTORY_REQUIRED'; END IF;
 -- Closure also binds the receipt to both actual events, not merely their IDs.
 IF EXISTS(SELECT 1 FROM master_wok_event_test.booking_transfers receipt
  JOIN master_wok_event_test.streams from_day ON from_day.id=receipt.source_stream
  JOIN master_wok_event_test.streams to_day ON to_day.id=receipt.destination_stream
  JOIN master_wok_event_test.events outgoing ON outgoing.stream_id=receipt.source_stream AND outgoing.event_id=receipt.request_id||'_out'
  JOIN master_wok_event_test.events incoming ON incoming.stream_id=receipt.destination_stream AND incoming.event_id=receipt.request_id||'_in'
  LEFT JOIN master_wok_event_test.booking_rows from_row ON from_row.stream_id=receipt.source_stream AND from_row.id::text=receipt.command->>'order'
  LEFT JOIN master_wok_event_test.booking_rows to_row ON to_row.stream_id=receipt.destination_stream AND to_row.id::text=receipt.command->>'order'
  WHERE receipt.source_stream=ANY(sources) AND (
   from_row.id IS NULL OR to_row.id IS NULL OR
   receipt.command->>'source' IS DISTINCT FROM receipt.source_stream::text OR receipt.command->>'destination' IS DISTINCT FROM receipt.destination_stream::text OR
   outgoing.payload->>'eventId' IS DISTINCT FROM outgoing.event_id OR incoming.payload->>'eventId' IS DISTINCT FROM incoming.event_id OR
   outgoing.payload->'sequence' IS DISTINCT FROM to_jsonb(outgoing.sequence) OR incoming.payload->'sequence' IS DISTINCT FROM to_jsonb(incoming.sequence) OR
   outgoing.payload->>'orderId' IS DISTINCT FROM from_row.order_alias OR incoming.payload->'order'->>'orderId' IS DISTINCT FROM to_row.order_alias OR from_row.order_alias<>to_row.order_alias OR
   outgoing.payload->>'toServiceDate' IS DISTINCT FROM to_day.service_date::text OR incoming.payload->>'fromServiceDate' IS DISTINCT FROM from_day.service_date::text OR
   outgoing.payload->>'at' IS DISTINCT FROM to_char(receipt.event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') OR incoming.payload->>'at' IS DISTINCT FROM outgoing.payload->>'at' OR
   incoming.payload->>'actualDecision' IS DISTINCT FROM 'SUGGESTED' OR
   (incoming.payload->'order'->>'targetAt')::timestamptz IS DISTINCT FROM (receipt.command->>'target')::timestamptz
  )) THEN RAISE EXCEPTION 'CUTOVER_TRANSFER_BINDING_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.reservations WHERE stream_id=ANY(sources) GROUP BY order_id HAVING count(*)>1) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_rows WHERE stream_id=ANY(sources) GROUP BY order_alias HAVING count(DISTINCT id)>1) OR
  EXISTS(SELECT 1 FROM master_wok_event_test.booking_rows WHERE stream_id=ANY(sources) GROUP BY id HAVING count(*)>1 AND count(*) FILTER(WHERE status='moved_service_date')<>1) THEN RAISE EXCEPTION 'CUTOVER_ORDER_OWNERSHIP_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_event_test.booking_rows moved WHERE moved.stream_id=ANY(sources) AND moved.status='moved_service_date' AND NOT EXISTS(
  SELECT 1 FROM master_wok_event_test.booking_rows current_row WHERE current_row.stream_id=ANY(sources) AND current_row.stream_id<>moved.stream_id AND current_row.id=moved.id AND
   current_row.status<>'moved_service_date' AND current_row.order_alias=moved.order_alias AND current_row.order_type=moved.order_type AND
   master_wok_event_test.booking_payload(current_row.stream_id,current_row.id,current_row.preferred_time)->'lines'=master_wok_event_test.booking_payload(moved.stream_id,moved.id,moved.preferred_time)->'lines' AND
   EXISTS(SELECT 1 FROM master_wok_event_test.booking_transfers receipt WHERE receipt.source_stream=moved.stream_id AND receipt.destination_stream=current_row.stream_id AND receipt.command->>'order'=moved.id::text)
 )) THEN RAISE EXCEPTION 'CUTOVER_MOVED_STATE_UNVERIFIED'; END IF;
 cutover_at:=clock_timestamp();
 FOR mapping IN SELECT value FROM jsonb_array_elements(maps) LOOP
  src:=(mapping->>'source')::uuid;dst:=(mapping->>'destination')::uuid;
  ordinal:=ordinal+1;event_id:=p_request||CASE ordinal WHEN 1 THEN '_a' ELSE '_b' END;
  baseline:=master_wok_event_test.cutover_snapshot(src,event_id,cutover_at,true);
  INSERT INTO master_wok_event_test.booking_rows(stream_id,id,order_alias,created_at,status,order_type,preferred_time,proposed_time,confirmed_time,current_proposal_event_id) SELECT dst,id,order_alias,created_at,status,order_type,preferred_time,proposed_time,confirmed_time,current_proposal_event_id FROM master_wok_event_test.booking_rows WHERE stream_id=src;
  INSERT INTO master_wok_event_test.booking_items(stream_id,order_id,line_no,item_id,qty,modifiers) SELECT dst,order_id,line_no,item_id,qty,modifiers FROM master_wok_event_test.booking_items WHERE stream_id=src;
  INSERT INTO master_wok_event_test.booking_commands(stream_id,request_id,command) SELECT dst,request_id,command FROM master_wok_event_test.booking_commands WHERE stream_id=src;
  INSERT INTO master_wok_event_test.reservations(stream_id,order_id,commitment,proposal_event_id,order_payload) SELECT dst,order_id,commitment,proposal_event_id,order_payload FROM master_wok_event_test.reservations WHERE stream_id=src;
  INSERT INTO master_wok_event_test.events VALUES(dst,1,event_id,baseline);
  INSERT INTO master_wok_event_test.booking_commands VALUES(dst,p_request,cmd);
  UPDATE master_wok_event_test.streams SET event_count=1,last_at=cutover_at WHERE id=dst;
 END LOOP;
 -- Earlier transfer receipts keep their original stream IDs. Never fabricate baseline transfer events.
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id=ANY(sources);
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.seed_cutover_pair(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
