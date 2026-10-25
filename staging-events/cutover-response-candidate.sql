-- UNINSTALLED REVIEW CANDIDATE. Private synthetic schema only; no grants.
-- Single-hop, same-day cutovers only. Route selection is a separate boundary.
CREATE FUNCTION master_wok_event_test.apply_cutover_response(
 p_source uuid,p_destination uuid,p_cutover text,p_request text,
 p_alias text,p_action text,p_proposal text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE;
 d master_wok_event_test.streams%ROWTYPE; receipt jsonb; booking uuid;
BEGIN
 IF p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR
  coalesce(p_cutover,'') !~ '^[a-zA-Z0-9_-]{1,100}$' OR
  coalesce(p_action,'') NOT IN ('accept','reject') OR
  coalesce(p_alias,'') !~ '^synthetic-[a-z0-9_-]{1,80}$' OR
  coalesce(p_proposal,'') !~ '^[a-zA-Z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'CUTOVER_RESPONSE_REQUIRED'; END IF;
 -- Match the seeder's lock order; a later switch cannot race this response.
 PERFORM 1 FROM master_wok_event_test.streams WHERE id IN (p_source,p_destination) ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_source;
 SELECT * INTO STRICT d FROM master_wok_event_test.streams WHERE id=p_destination;
 IF s.enabled OR NOT d.enabled OR s.service_date<>d.service_date OR
  s.scope<>'SYNTHETIC_STAGING_EVENTS' OR d.scope<>s.scope THEN RAISE EXCEPTION 'CUTOVER_ROUTE_UNPROVEN'; END IF;
 SELECT command INTO receipt FROM master_wok_event_test.booking_commands
  WHERE stream_id=p_destination AND request_id=p_cutover;
 IF receipt IS DISTINCT FROM jsonb_build_object('action','cutover','source',p_source,'destination',p_destination) OR
  NOT EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id=p_destination AND sequence=1
   AND event_id=p_cutover AND payload->>'kind'='CUTOVER_BASELINE') THEN RAISE EXCEPTION 'CUTOVER_ROUTE_UNPROVEN'; END IF;
 SELECT id INTO STRICT booking FROM master_wok_event_test.booking_rows
  WHERE stream_id=p_destination AND order_alias=p_alias;
 RETURN master_wok_event_test.apply_booking(p_destination,p_request,booking,p_action,NULL,p_proposal);
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
