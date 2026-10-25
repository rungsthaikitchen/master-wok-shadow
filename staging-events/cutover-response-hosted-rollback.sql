BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'; SET LOCAL TIME ZONE 'UTC';
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

DO $test$
DECLARE src uuid:=gen_random_uuid(); dst uuid:=gen_random_uuid(); booking uuid:=gen_random_uuid();
 day date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date+1; result text;
BEGIN
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES(src,day,true),(dst,day,true);
 PERFORM master_wok_event_test.create_booking(src,'create',booking,'synthetic-response-handover',day+time '18:00','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.apply_booking(src,'offer-a',booking,'offer',day+time '19:00',NULL);
 PERFORM master_wok_event_test.seed_cutover_baseline(src,dst,'baseline');
 PERFORM pg_sleep(0.01);
 ASSERT master_wok_event_test.apply_cutover_response(src,dst,'baseline','reply','synthetic-response-handover','accept','offer-a')='RECORDED';
 ASSERT master_wok_event_test.apply_cutover_response(src,dst,'baseline','reply','synthetic-response-handover','accept','offer-a')='ALREADY_RECORDED';
 ASSERT (SELECT count(*)=1 FROM master_wok_event_test.reservations WHERE stream_id=dst);
 ASSERT (SELECT commitment='CONFIRMED' FROM master_wok_event_test.reservations WHERE stream_id=dst);
 PERFORM master_wok_event_test.apply_booking(dst,'offer-b',booking,'offer',day+time '19:30',NULL);
 BEGIN
  PERFORM master_wok_event_test.apply_cutover_response(src,dst,'baseline','stale','synthetic-response-handover','reject','offer-a');
  RAISE EXCEPTION 'STALE_RESPONSE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STALE_PROPOSAL_RESPONSE' THEN RAISE; END IF; END;
 BEGIN
  PERFORM master_wok_event_test.apply_cutover_response(src,dst,'missing','unproven','synthetic-response-handover','accept','offer-b');
  RAISE EXCEPTION 'UNPROVEN_ROUTE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CUTOVER_ROUTE_UNPROVEN' THEN RAISE; END IF; END;
 ASSERT (SELECT event_count=3 FROM master_wok_event_test.streams WHERE id=dst);
 ASSERT (SELECT current_proposal_event_id='offer-b' FROM master_wok_event_test.booking_rows WHERE stream_id=dst);
 ASSERT NOT has_function_privilege('anon','master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text)','EXECUTE');
END $test$;
ROLLBACK; SELECT to_regprocedure('master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text)') IS NULL AS candidate_removed_by_rollback,count(*) FILTER (WHERE enabled) AS enabled_streams FROM master_wok_event_test.streams;
