BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'; SET LOCAL TIME ZONE 'UTC';
-- Isolated synthetic staging candidate. No production objects or grants.
CREATE TABLE master_wok_event_test.command_routes (
 id uuid PRIMARY KEY,
 service_date date NOT NULL,
 scope text NOT NULL DEFAULT 'SYNTHETIC_STAGING_EVENTS' CHECK(scope='SYNTHETIC_STAGING_EVENTS'),
 current_stream uuid NOT NULL UNIQUE REFERENCES master_wok_event_test.streams(id),
 generation integer NOT NULL DEFAULT 0 CHECK(generation IN (0,1)),
 previous_stream uuid REFERENCES master_wok_event_test.streams(id),
 cutover_request text,
 CHECK((generation=0 AND previous_stream IS NULL AND cutover_request IS NULL) OR
       (generation=1 AND previous_stream IS NOT NULL AND previous_stream<>current_stream AND cutover_request IS NOT NULL))
);
ALTER TABLE master_wok_event_test.command_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_wok_event_test.command_routes FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.switch_command_route(p_route uuid,p_expected integer,p_destination uuid,p_request text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE r master_wok_event_test.command_routes%ROWTYPE;
BEGIN
 IF p_route IS NULL OR p_destination IS NULL OR p_expected IS DISTINCT FROM 0 OR coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'ROUTE_SWITCH_REQUIRED'; END IF;
 -- Every cooperating routed writer takes the shared form before reading the route.
 -- Hash collisions only serialize unrelated routes; they cannot select another route.
 PERFORM pg_advisory_xact_lock(hashtextextended('master-wok-route:'||p_route::text,0));
 SELECT * INTO STRICT r FROM master_wok_event_test.command_routes WHERE id=p_route FOR UPDATE;
 IF r.generation=1 THEN
  IF r.current_stream=p_destination AND r.cutover_request=p_request THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'ROUTE_REVISION_CONFLICT';
 END IF;
 IF r.generation<>p_expected OR NOT EXISTS(SELECT 1 FROM master_wok_event_test.streams WHERE id=r.current_stream AND service_date=r.service_date) THEN RAISE EXCEPTION 'ROUTE_REVISION_CONFLICT'; END IF;
 PERFORM master_wok_event_test.seed_cutover_baseline(r.current_stream,p_destination,p_request);
 PERFORM master_wok_event_test.authorize_cutover_response_route(r.current_stream,p_destination,p_request);
 UPDATE master_wok_event_test.command_routes SET current_stream=p_destination,generation=1,previous_stream=r.current_stream,cutover_request=p_request WHERE id=p_route;
 RETURN 'RECORDED';
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.switch_command_route(uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.routed_create_booking(p_route uuid,p_request text,p_order uuid,p_alias text,p_preferred timestamptz,p_lines jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE r master_wok_event_test.command_routes%ROWTYPE;
BEGIN
 IF p_route IS NULL THEN RAISE EXCEPTION 'ROUTE_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('master-wok-route:'||p_route::text,0));
 SELECT * INTO STRICT r FROM master_wok_event_test.command_routes WHERE id=p_route;
 IF NOT EXISTS(SELECT 1 FROM master_wok_event_test.streams WHERE id=r.current_stream AND enabled AND service_date=r.service_date AND scope=r.scope) THEN RAISE EXCEPTION 'CURRENT_ROUTE_DISABLED'; END IF;
 RETURN master_wok_event_test.create_booking(r.current_stream,p_request,p_order,p_alias,p_preferred,p_lines);
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.routed_create_booking(uuid,text,uuid,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.routed_apply_booking(p_route uuid,p_request text,p_alias text,p_action text,p_target timestamptz,p_proposal text,p_origin uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE r master_wok_event_test.command_routes%ROWTYPE; booking uuid;
BEGIN
 IF p_route IS NULL OR coalesce(p_alias,'') !~ '^synthetic-[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'ROUTED_COMMAND_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('master-wok-route:'||p_route::text,0));
 SELECT * INTO STRICT r FROM master_wok_event_test.command_routes WHERE id=p_route;
 IF NOT EXISTS(SELECT 1 FROM master_wok_event_test.streams WHERE id=r.current_stream AND enabled AND service_date=r.service_date AND scope=r.scope) THEN RAISE EXCEPTION 'CURRENT_ROUTE_DISABLED'; END IF;
 IF p_action IN ('accept','reject') THEN
  IF p_origin IS NULL OR p_target IS NOT NULL THEN RAISE EXCEPTION 'SIGNED_RESPONSE_ORIGIN_REQUIRED'; END IF;
  IF p_origin<>r.current_stream THEN
   IF p_origin IS DISTINCT FROM r.previous_stream OR r.generation<>1 THEN RAISE EXCEPTION 'RESPONSE_ORIGIN_ROUTE_REQUIRED'; END IF;
   RETURN master_wok_event_test.apply_cutover_response(p_origin,r.current_stream,r.cutover_request,p_request,p_alias,p_action,p_proposal);
  END IF;
 ELSIF p_origin IS NOT NULL OR p_action NOT IN ('offer','confirm','cancel','complete') THEN RAISE EXCEPTION 'ROUTED_COMMAND_REQUIRED'; END IF;
 SELECT id INTO STRICT booking FROM master_wok_event_test.booking_rows WHERE stream_id=r.current_stream AND order_alias=p_alias;
 RETURN master_wok_event_test.apply_booking(r.current_stream,p_request,booking,p_action,p_target,p_proposal);
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.export_command_route(p_route uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
 SELECT jsonb_build_object('project','hvrqgufqjslvgiohgkvu','routeId',r.id,'scope',r.scope,'serviceDate',r.service_date,
  'generation',r.generation,'streamId',r.current_stream,'previousStreamId',r.previous_stream,'cutoverRequest',r.cutover_request,
  'enabled',s.enabled,'eventCount',s.event_count,'attested',CASE WHEN r.generation=0 THEN false ELSE EXISTS(
   SELECT 1 FROM master_wok_event_test.cutover_response_routes a WHERE a.source_stream=r.previous_stream AND a.destination_stream=r.current_stream AND a.cutover_request=r.cutover_request) END,
  'previousRetired',CASE WHEN r.generation=1 THEN NOT old.enabled ELSE false END,
  'previousEventCount',CASE WHEN r.generation=1 THEN old.event_count ELSE NULL END,
  'previousBatch',CASE WHEN r.generation=1 THEN master_wok_event_test.export(r.previous_stream) ELSE NULL END,
  'batch',master_wok_event_test.export(r.current_stream))
 FROM master_wok_event_test.command_routes r JOIN master_wok_event_test.streams s ON s.id=r.current_stream AND s.service_date=r.service_date AND s.scope=r.scope
 LEFT JOIN master_wok_event_test.streams old ON old.id=r.previous_stream AND old.service_date=r.service_date AND old.scope=r.scope
 WHERE r.id=p_route;
$$;
REVOKE ALL ON FUNCTION master_wok_event_test.export_command_route(uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Private staging role proposal. No direct route writes or switch execution.
GRANT SELECT ON master_wok_event_test.command_routes TO master_wok_event_reader_login,master_wok_event_writer_login;
CREATE POLICY command_route_reader ON master_wok_event_test.command_routes FOR SELECT TO master_wok_event_reader_login,master_wok_event_writer_login USING(scope='SYNTHETIC_STAGING_EVENTS');
GRANT SELECT ON master_wok_event_test.cutover_response_routes TO master_wok_event_reader_login,master_wok_event_writer_login;
CREATE POLICY command_route_attestation_reader ON master_wok_event_test.cutover_response_routes FOR SELECT TO master_wok_event_reader_login USING(true);
GRANT EXECUTE ON FUNCTION master_wok_event_test.export_command_route(uuid) TO master_wok_event_reader_login;
GRANT EXECUTE ON FUNCTION master_wok_event_test.routed_create_booking(uuid,text,uuid,text,timestamptz,jsonb),master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid),master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text) TO master_wok_event_writer_login;

DO $test$
DECLARE r uuid:=gen_random_uuid(); src uuid:=gen_random_uuid(); dst uuid:=gen_random_uuid(); booking uuid:=gen_random_uuid();
 day date:=(clock_timestamp() AT TIME ZONE 'Europe/London')::date+1; before jsonb; switched jsonb; final jsonb;
BEGIN
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES(src,day,true),(dst,day,true);
 INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES(r,day,src);
 ASSERT master_wok_event_test.routed_create_booking(r,'create',booking,'synthetic-router',day+time '18:00','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]')='RECORDED';
 ASSERT master_wok_event_test.routed_apply_booking(r,'offer-a','synthetic-router','offer',day+time '19:00',NULL,NULL)='RECORDED';
 before:=master_wok_event_test.export_command_route(r);
 PERFORM master_wok_event_test.routed_apply_booking(r,'offer-between-polls','synthetic-router','offer',day+time '19:15',NULL,NULL);
 BEGIN
  PERFORM master_wok_event_test.switch_command_route(r,0,dst,'switch');
  RAISE EXCEPTION 'INJECTED_AFTER_SWITCH';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'INJECTED_AFTER_SWITCH' THEN RAISE; END IF; END;
 ASSERT (SELECT generation=0 AND current_stream=src FROM master_wok_event_test.command_routes WHERE id=r);
 ASSERT (SELECT enabled FROM master_wok_event_test.streams WHERE id=src);
 ASSERT (SELECT event_count=0 FROM master_wok_event_test.streams WHERE id=dst);
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.cutover_response_routes WHERE source_stream=src);
 ASSERT master_wok_event_test.switch_command_route(r,0,dst,'switch')='RECORDED';
 ASSERT master_wok_event_test.switch_command_route(r,0,dst,'switch')='ALREADY_RECORDED';
 switched:=master_wok_event_test.export_command_route(r);
 ASSERT switched->>'streamId'=dst::text AND switched->>'previousStreamId'=src::text AND (switched->>'generation')::int=1 AND (switched->>'attested')::boolean;
 PERFORM pg_sleep(0.01);
 ASSERT master_wok_event_test.routed_apply_booking(r,'old-reply','synthetic-router','accept',NULL,'offer-between-polls',src)='RECORDED';
 ASSERT master_wok_event_test.routed_apply_booking(r,'old-reply','synthetic-router','accept',NULL,'offer-between-polls',src)='ALREADY_RECORDED';
 PERFORM master_wok_event_test.routed_apply_booking(r,'offer-b','synthetic-router','offer',day+time '19:30',NULL,NULL);
 BEGIN
  PERFORM master_wok_event_test.routed_apply_booking(r,'stale','synthetic-router','reject',NULL,'offer-between-polls',src);
  RAISE EXCEPTION 'STALE_RESPONSE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STALE_PROPOSAL_RESPONSE' THEN RAISE; END IF; END;
 ASSERT master_wok_event_test.routed_apply_booking(r,'new-reply','synthetic-router','reject',NULL,'offer-b',dst)='RECORDED';
 final:=master_wok_event_test.export_command_route(r);
 ASSERT (final->>'eventCount')::int=4;
 ASSERT NOT EXISTS(SELECT 1 FROM master_wok_event_test.reservations WHERE stream_id=dst);
 ASSERT NOT has_table_privilege('master_wok_event_writer_login','master_wok_event_test.command_routes','INSERT,UPDATE,DELETE');
 ASSERT NOT has_function_privilege('master_wok_event_writer_login','master_wok_event_test.switch_command_route(uuid,integer,uuid,text)','EXECUTE');
 ASSERT has_function_privilege('master_wok_event_writer_login','pg_catalog.pg_advisory_xact_lock_shared(bigint)','EXECUTE');
 PERFORM set_config('master_wok_trial.route_capture',jsonb_build_object('basis','HOSTED_POSTGRES_ROLLED_BACK_SYNTHETIC','initial',before,'switched',switched,'final',final)::text,true);
END $test$;
SELECT current_setting('master_wok_trial.route_capture')::jsonb AS capture;
ROLLBACK;