-- Private staging candidate: one STABLE call reads histories and receipts in one snapshot.
CREATE FUNCTION master_wok_event_test.export_transfer_pair(p_a uuid,p_b uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE n integer; result jsonb;
BEGIN
 IF p_a IS NULL OR p_b IS NULL OR p_a=p_b THEN RAISE EXCEPTION 'TWO_STREAMS_REQUIRED'; END IF;
 SELECT count(*) INTO n FROM master_wok_event_test.streams WHERE id IN (p_a,p_b) AND enabled AND scope='SYNTHETIC_STAGING_EVENTS' AND event_count>0;
 IF n<>2 THEN RAISE EXCEPTION 'TWO_COMPLETE_STREAMS_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM master_wok_event_test.booking_transfers WHERE (source_stream IN (p_a,p_b) OR destination_stream IN (p_a,p_b)) AND NOT(source_stream IN (p_a,p_b) AND destination_stream IN (p_a,p_b))) THEN RAISE EXCEPTION 'TRANSFER_CLOSURE_REQUIRED'; END IF;
 SELECT jsonb_build_object('basis','CONSISTENT_TRANSFER_SNAPSHOT','project','hvrqgufqjslvgiohgkvu',
  'streams',(SELECT jsonb_agg(jsonb_build_object('streamId',id::text,'batch',master_wok_event_test.export(id)) ORDER BY id) FROM master_wok_event_test.streams WHERE id IN (p_a,p_b)),
  'transfers',(SELECT coalesce(jsonb_agg(jsonb_build_object('transferId',t.request_id,'sourceStream',t.source_stream::text,'destinationStream',t.destination_stream::text,
   'eventAt',to_char(t.event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'orderId',e.payload->>'orderId','targetAt',t.command->>'target') ORDER BY t.request_id),'[]'::jsonb)
   FROM master_wok_event_test.booking_transfers t LEFT JOIN master_wok_event_test.events e ON e.stream_id=t.source_stream AND e.event_id=t.request_id||'_out' WHERE t.source_stream IN (p_a,p_b) AND t.destination_stream IN (p_a,p_b))) INTO result;
 IF octet_length(result::text)>10000000 THEN RAISE EXCEPTION 'TRANSFER_BUNDLE_TOO_LARGE'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.export_transfer_pair(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
