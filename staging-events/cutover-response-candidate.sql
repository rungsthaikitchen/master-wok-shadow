-- Private synthetic staging only. Runtime receives SELECT, never attestation writes.
CREATE TABLE master_wok_event_test.cutover_response_routes (
 source_stream uuid PRIMARY KEY REFERENCES master_wok_event_test.streams(id),
 destination_stream uuid NOT NULL UNIQUE REFERENCES master_wok_event_test.streams(id),
 cutover_request text NOT NULL,
 CHECK(source_stream<>destination_stream)
);
ALTER TABLE master_wok_event_test.cutover_response_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_wok_event_test.cutover_response_routes FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION master_wok_event_test.authorize_cutover_response_route(p_source uuid,p_destination uuid,p_cutover text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE s master_wok_event_test.streams%ROWTYPE; d master_wok_event_test.streams%ROWTYPE; prior record; receipt jsonb;
BEGIN
 IF p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR coalesce(p_cutover,'') !~ '^[a-zA-Z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'CUTOVER_ROUTE_REQUIRED'; END IF;
 PERFORM 1 FROM master_wok_event_test.streams WHERE id IN (p_source,p_destination) ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT s FROM master_wok_event_test.streams WHERE id=p_source;
 SELECT * INTO STRICT d FROM master_wok_event_test.streams WHERE id=p_destination;
 SELECT command INTO receipt FROM master_wok_event_test.booking_commands WHERE stream_id=p_destination AND request_id=p_cutover;
 IF s.enabled OR NOT d.enabled OR s.service_date<>d.service_date OR s.scope<>'SYNTHETIC_STAGING_EVENTS' OR d.scope<>s.scope OR
  receipt IS DISTINCT FROM jsonb_build_object('action','cutover','source',p_source,'destination',p_destination) OR
  NOT EXISTS(SELECT 1 FROM master_wok_event_test.events WHERE stream_id=p_destination AND sequence=1 AND event_id=p_cutover AND payload->>'kind'='CUTOVER_BASELINE') THEN RAISE EXCEPTION 'CUTOVER_ROUTE_UNPROVEN'; END IF;
 SELECT * INTO prior FROM master_wok_event_test.cutover_response_routes WHERE source_stream=p_source;
 IF FOUND THEN
  IF prior.destination_stream=p_destination AND prior.cutover_request=p_cutover THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'CUTOVER_ROUTE_CONFLICT';
 END IF;
 INSERT INTO master_wok_event_test.cutover_response_routes VALUES(p_source,p_destination,p_cutover);
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.authorize_cutover_response_route(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- UNINSTALLED REVIEW CANDIDATE. Private synthetic schema only; no grants.
-- Single-hop, same-day cutovers only. Route selection is a separate boundary.
CREATE OR REPLACE FUNCTION master_wok_event_test.apply_cutover_response(
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
 IF NOT EXISTS(SELECT 1 FROM master_wok_event_test.cutover_response_routes WHERE source_stream=p_source AND destination_stream=p_destination AND cutover_request=p_cutover) THEN RAISE EXCEPTION 'ADMIN_CUTOVER_ROUTE_REQUIRED'; END IF;
 SELECT id INTO STRICT booking FROM master_wok_event_test.booking_rows
  WHERE stream_id=p_destination AND order_alias=p_alias;
 RETURN master_wok_event_test.apply_booking(p_destination,p_request,booking,p_action,NULL,p_proposal);
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
