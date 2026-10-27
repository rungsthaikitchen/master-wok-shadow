-- Local synthetic candidate only. No production objects or runtime grants.
CREATE TABLE master_wok_event_test.staff_commands (
 route_id uuid NOT NULL REFERENCES master_wok_event_test.command_routes(id),
 command_id uuid NOT NULL, actor_id text NOT NULL CHECK(actor_id ~ '^[a-f0-9]{64}$'),
 command jsonb NOT NULL, stream_id uuid NOT NULL,
 event_sequence integer NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(route_id,command_id),
 FOREIGN KEY(stream_id,event_sequence) REFERENCES master_wok_event_test.events(stream_id,sequence)
);
ALTER TABLE master_wok_event_test.staff_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_wok_event_test.staff_commands FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.apply_staff_command(p_route uuid,p_command uuid,p_actor text,p_order uuid,p_revision integer,p_action text,p_target timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE r master_wok_event_test.command_routes%ROWTYPE; b master_wok_event_test.booking_rows%ROWTYPE;
 prior master_wok_event_test.staff_commands%ROWTYPE; cmd jsonb; revision integer; outcome text; seq integer;
BEGIN
 IF p_route IS NULL OR p_command IS NULL OR p_order IS NULL OR coalesce(p_actor,'') !~ '^[a-f0-9]{64}$' OR
    p_revision IS NULL OR p_revision<1 OR coalesce(p_action,'') NOT IN ('offer','confirm','cancel','complete') OR
    (p_action='offer')<>(p_target IS NOT NULL) THEN RAISE EXCEPTION 'STAFF_COMMAND_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('master-wok-route:'||p_route::text,0));
 SELECT * INTO STRICT r FROM master_wok_event_test.command_routes WHERE id=p_route;
 -- Cross-cutover retry identity needs explicit migration; do not silently reapply.
 IF r.generation<>0 THEN RAISE EXCEPTION 'STAFF_ROUTE_CUTOVER_UNVERIFIED'; END IF;
 PERFORM 1 FROM master_wok_event_test.streams WHERE id=r.current_stream AND enabled AND service_date=r.service_date AND scope=r.scope FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CURRENT_ROUTE_DISABLED'; END IF;
 cmd:=jsonb_build_object('version',1,'orderId',p_order,'expectedRevision',p_revision,'action',p_action,'target',p_target);
 SELECT * INTO prior FROM master_wok_event_test.staff_commands WHERE route_id=p_route AND command_id=p_command;
 IF FOUND THEN
  IF prior.actor_id IS DISTINCT FROM p_actor OR prior.command IS DISTINCT FROM cmd THEN RAISE EXCEPTION 'STAFF_COMMAND_ID_REUSED'; END IF;
  RETURN jsonb_build_object('status','ALREADY_RECORDED','revision',prior.event_sequence);
 END IF;
 SELECT * INTO STRICT b FROM master_wok_event_test.booking_rows WHERE stream_id=r.current_stream AND id=p_order FOR UPDATE;
 -- Order revision is its latest recorded event sequence, not the requested time.
 SELECT max(sequence) INTO revision FROM master_wok_event_test.events WHERE stream_id=r.current_stream AND
  (payload->>'orderId'=b.order_alias OR payload->'order'->>'orderId'=b.order_alias);
 IF revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'STAFF_REVISION_CONFLICT'; END IF;
 outcome:=master_wok_event_test.routed_apply_booking(p_route,p_command::text,b.order_alias,p_action,p_target,NULL,NULL);
 IF outcome<>'RECORDED' THEN RAISE EXCEPTION 'STAFF_AUDIT_REQUIRED'; END IF;
 SELECT sequence INTO STRICT seq FROM master_wok_event_test.events WHERE stream_id=r.current_stream AND event_id=p_command::text;
 INSERT INTO master_wok_event_test.staff_commands(route_id,command_id,actor_id,command,stream_id,event_sequence)
 VALUES(p_route,p_command,p_actor,cmd,r.current_stream,seq);
 RETURN jsonb_build_object('status','RECORDED','revision',seq);
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
