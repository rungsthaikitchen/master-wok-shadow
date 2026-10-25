-- OFFLINE synthetic candidate only; no production tables, runtime grants or deployment.
-- Trusted fixture administrator binds the COMPLETE envelope, not just its prices.
CREATE TABLE master_wok_event_test.full_checkout_quotes (
 id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES master_wok_event_test.command_routes(id),
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);
CREATE TABLE master_wok_event_test.full_checkout_submissions (
 route_id uuid NOT NULL REFERENCES master_wok_event_test.command_routes(id), request_id text NOT NULL,
 order_id uuid NOT NULL, quote_id uuid NOT NULL UNIQUE REFERENCES master_wok_event_test.full_checkout_quotes(id),
 origin_stream uuid NOT NULL REFERENCES master_wok_event_test.streams(id), command jsonb NOT NULL,
 PRIMARY KEY(route_id,request_id), UNIQUE(route_id,order_id)
);
CREATE TABLE master_wok_event_test.full_checkout_orders (
 route_id uuid NOT NULL, request_id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(route_id,request_id), FOREIGN KEY(route_id,request_id) REFERENCES master_wok_event_test.full_checkout_submissions(route_id,request_id)
);
CREATE TABLE master_wok_event_test.full_checkout_items (
 route_id uuid NOT NULL, request_id text NOT NULL, line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 100), payload jsonb NOT NULL,
 PRIMARY KEY(route_id,request_id,line_no), FOREIGN KEY(route_id,request_id) REFERENCES master_wok_event_test.full_checkout_orders(route_id,request_id)
);
ALTER TABLE master_wok_event_test.full_checkout_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.full_checkout_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.full_checkout_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.full_checkout_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_wok_event_test.full_checkout_quotes,master_wok_event_test.full_checkout_submissions,master_wok_event_test.full_checkout_orders,master_wok_event_test.full_checkout_items FROM PUBLIC,anon,authenticated,service_role;

-- Fixed schema-only metadata from the reviewed source/column fixture. Does not
-- copy defaults or persist any customer data in the definition.
CREATE FUNCTION master_wok_event_test.validate_full_checkout_object(v jsonb,t text,page text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE contracts CONSTANT jsonb := '{"index.html":{"orders":["customer_id","subtotal","discount","discount_label","discount_code","discount_amount","delivery_fee","delivery_straight_line_miles","delivery_route_miles","delivery_distance_source","total","loyalty_discount","loyalty_points_redeem_pending","loyalty_points_earned_pending","loyalty_reward_applied","loyalty_expected_balance","loyalty_settled","order_type","notes","order_ref","payment_preference","preferred_time","asap_requested","communication_preference","idempotency_key"],"order_items":["order_id","item_id","name","unit_price","qty","modifiers","spice","img","kitchen_load"]},"index_inline_ordering_refactor.html":{"orders":["customer_id","subtotal","discount","discount_label","delivery_fee","total","loyalty_discount","loyalty_points_redeem_pending","loyalty_points_earned_pending","loyalty_reward_applied","loyalty_expected_balance","loyalty_settled","order_type","notes","order_ref","payment_preference","preferred_time","asap_requested","communication_preference","idempotency_key"],"order_items":["order_id","item_id","name","unit_price","qty","modifiers","spice","img"]},"images/index_inline_ordering_refactor.html":{"orders":["customer_id","subtotal","discount","discount_label","delivery_fee","total","loyalty_discount","loyalty_points_redeem_pending","loyalty_points_earned_pending","loyalty_reward_applied","loyalty_expected_balance","loyalty_settled","order_type","notes","order_ref","payment_preference","preferred_time","asap_requested","communication_preference","idempotency_key"],"order_items":["order_id","item_id","name","unit_price","qty","modifiers","spice","img"]}}'; columns CONSTANT jsonb := '{"orders":{"id":{"type":"uuid","nullable":false},"customer_id":{"type":"uuid","nullable":true},"status":{"type":"text","nullable":false},"subtotal":{"type":"numeric","nullable":false},"notes":{"type":"text","nullable":true},"created_at":{"type":"timestamp with time zone","nullable":true},"order_type":{"type":"text","nullable":true},"delivery_fee":{"type":"numeric","nullable":true},"order_ref":{"type":"text","nullable":true},"preferred_time":{"type":"timestamp with time zone","nullable":true},"review_status":{"type":"text","nullable":false},"confirmed_time":{"type":"timestamp with time zone","nullable":true},"payment_link":{"type":"text","nullable":true},"communication_channel":{"type":"text","nullable":true},"payment_preference":{"type":"text","nullable":false},"payment_status":{"type":"text","nullable":false},"paid_at":{"type":"timestamp with time zone","nullable":true},"confirm_token":{"type":"text","nullable":true},"proposed_time":{"type":"timestamp with time zone","nullable":true},"paid":{"type":"boolean","nullable":true},"communication_preference":{"type":"text","nullable":true},"asap_requested":{"type":"boolean","nullable":false},"delivery_address":{"type":"text","nullable":true},"customer_lat":{"type":"double precision","nullable":true},"customer_lng":{"type":"double precision","nullable":true},"idempotency_key":{"type":"text","nullable":true},"discount":{"type":"numeric","nullable":true},"total":{"type":"numeric","nullable":true},"discount_label":{"type":"text","nullable":true},"is_test":{"type":"boolean","nullable":false},"loyalty_settled":{"type":"boolean","nullable":false},"loyalty_discount":{"type":"numeric","nullable":false},"loyalty_points_redeem_pending":{"type":"integer","nullable":false},"loyalty_points_earned_pending":{"type":"integer","nullable":false},"loyalty_reward_applied":{"type":"boolean","nullable":false},"loyalty_expected_balance":{"type":"integer","nullable":true},"delivery_straight_line_miles":{"type":"numeric","nullable":true},"delivery_route_miles":{"type":"numeric","nullable":true},"delivery_distance_source":{"type":"text","nullable":true},"staff_notified_at":{"type":"timestamp with time zone","nullable":true},"staff_notify_attempts":{"type":"integer","nullable":true},"staff_notify_error":{"type":"text","nullable":true},"discount_code":{"type":"text","nullable":true},"discount_amount":{"type":"numeric","nullable":true},"device_os":{"type":"text","nullable":true},"user_agent":{"type":"text","nullable":true},"device_platform":{"type":"text","nullable":true}},"order_items":{"id":{"type":"uuid","nullable":false},"order_id":{"type":"uuid","nullable":true},"item_id":{"type":"text","nullable":false},"name":{"type":"text","nullable":false},"unit_price":{"type":"numeric","nullable":false},"qty":{"type":"integer","nullable":false},"modifiers":{"type":"jsonb","nullable":true},"spice":{"type":"integer","nullable":true},"img":{"type":"text","nullable":true},"item_note":{"type":"text","nullable":true},"kitchen_load":{"type":"numeric","nullable":true}}}';
 k text; x jsonb; col jsonb; typ text; required jsonb;
BEGIN
 required:=contracts->page->t;
 IF required IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FULL_CHECKOUT_FIELDS_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements_text(required) f WHERE NOT v ? f) OR
    EXISTS(SELECT FROM jsonb_object_keys(v) f WHERE NOT required ? f AND NOT(t='order_items' AND f='item_note')) THEN RAISE EXCEPTION 'FULL_CHECKOUT_FIELDS_REQUIRED'; END IF;
 FOR k,x IN SELECT * FROM jsonb_each(v) LOOP
  col:=columns->t->k; typ:=col->>'type';
  IF x='null'::jsonb THEN
   IF NOT (col->>'nullable')::boolean THEN RAISE EXCEPTION 'FULL_CHECKOUT_VALUE_REQUIRED'; END IF;
   CONTINUE;
  END IF;
  IF (typ IN ('text','uuid','timestamp with time zone') AND jsonb_typeof(x)<>'string') OR
     (typ='boolean' AND jsonb_typeof(x)<>'boolean') OR
     (typ IN ('integer','numeric','double precision') AND jsonb_typeof(x)<>'number') OR
     (typ='jsonb' AND jsonb_typeof(x)<>'array') THEN RAISE EXCEPTION 'FULL_CHECKOUT_VALUE_REQUIRED'; END IF;
  IF typ='uuid' AND (x#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'FULL_CHECKOUT_VALUE_REQUIRED'; END IF;
  IF typ='integer' AND ((x#>>'{}') !~ '^-?[0-9]+$' OR (x#>>'{}')::numeric NOT BETWEEN -2147483648 AND 2147483647) THEN RAISE EXCEPTION 'FULL_CHECKOUT_VALUE_REQUIRED'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.validate_full_checkout_object(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.submit_full_checkout(p_route uuid,p_request text,p_order uuid,p_quote uuid,p_payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE r master_wok_event_test.command_routes%ROWTYPE; q master_wok_event_test.full_checkout_quotes%ROWTYPE;
 prior jsonb; cmd jsonb; o jsonb; items jsonb; item jsonb; modifier jsonb; mods jsonb; lines jsonb:='[]';
 page text; alias text; event_request text; target timestamptz; n integer:=0; result text;
BEGIN
 IF p_route IS NULL OR p_order IS NULL OR p_quote IS NULL OR coalesce(p_request,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'FULL_CHECKOUT_BINDING_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('master-wok-route:'||p_route::text,0));
 SELECT * INTO STRICT r FROM master_wok_event_test.command_routes WHERE id=p_route;
 PERFORM 1 FROM master_wok_event_test.streams WHERE id=r.current_stream AND enabled AND scope='SYNTHETIC_STAGING_EVENTS' AND scope=r.scope AND service_date=r.service_date FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CURRENT_ROUTE_DISABLED'; END IF;
 cmd:=jsonb_build_object('orderId',p_order,'quoteId',p_quote,'payload',p_payload);
 SELECT command INTO prior FROM master_wok_event_test.full_checkout_submissions WHERE route_id=p_route AND request_id=p_request;
 IF FOUND THEN
  IF prior=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'FULL_CHECKOUT_REQUEST_REUSED';
 END IF;
 SELECT * INTO STRICT q FROM master_wok_event_test.full_checkout_quotes WHERE id=p_quote;
 IF q.route_id<>p_route OR q.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'FULL_CHECKOUT_TRUSTED_QUOTE_MISMATCH'; END IF;
 IF q.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'FULL_CHECKOUT_QUOTE_EXPIRED'; END IF;
 IF EXISTS(SELECT FROM master_wok_event_test.full_checkout_submissions WHERE quote_id=p_quote) THEN RAISE EXCEPTION 'FULL_CHECKOUT_QUOTE_USED'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>300000 OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['orderAlias','privateWrite','source'] OR
  jsonb_typeof(p_payload->'source') IS DISTINCT FROM 'object' OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload->'source') k) IS DISTINCT FROM ARRAY['page','websiteCommit'] OR
  p_payload->'source'->>'websiteCommit' IS DISTINCT FROM '55938bc73cd762be614a300ef54bacaedda5f6b0' OR
  jsonb_typeof(p_payload->'privateWrite') IS DISTINCT FROM 'object' OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload->'privateWrite') k) IS DISTINCT FROM ARRAY['items','order'] OR
  jsonb_typeof(p_payload->'orderAlias') IS DISTINCT FROM 'string' OR
  coalesce(p_payload->>'orderAlias','') !~ '^synthetic-[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'FULL_CHECKOUT_ENVELOPE_REQUIRED'; END IF;
 page:=p_payload->'source'->>'page'; alias:=p_payload->>'orderAlias';
 o:=p_payload->'privateWrite'->'order'; items:=p_payload->'privateWrite'->'items';
 PERFORM master_wok_event_test.validate_full_checkout_object(o,'orders',page);
 IF o->>'idempotency_key' IS DISTINCT FROM p_request OR jsonb_typeof(o->'customer_id') IS DISTINCT FROM 'string' OR
    coalesce(o->>'order_type','') NOT IN ('collection','delivery') THEN RAISE EXCEPTION 'FULL_CHECKOUT_BINDING_REQUIRED'; END IF;
 -- This candidate needs a resolvable clock target; ASAP is not silently scheduled.
 IF o->'asap_requested' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(o->'preferred_time') IS DISTINCT FROM 'string' OR
    (o->>'preferred_time') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'FULL_CHECKOUT_TARGET_UNVERIFIED'; END IF;
 BEGIN
  target:=(o->>'preferred_time')::timestamptz;
  IF to_char(substr(o->>'preferred_time',1,19)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS')<>substr(o->>'preferred_time',1,19) THEN RAISE EXCEPTION 'FULL_CHECKOUT_TARGET_UNVERIFIED'; END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FULL_CHECKOUT_TARGET_UNVERIFIED'; END;
 IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'COMPLETE_BASKET_REQUIRED'; END IF;
 INSERT INTO master_wok_event_test.full_checkout_submissions VALUES(p_route,p_request,p_order,p_quote,r.current_stream,cmd);
 INSERT INTO master_wok_event_test.full_checkout_orders VALUES(p_route,p_request,o);
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  PERFORM master_wok_event_test.validate_full_checkout_object(item,'order_items',page);
  IF (item->>'order_id')::uuid IS DISTINCT FROM p_order OR jsonb_typeof(item->'item_id') IS DISTINCT FROM 'string' OR
     coalesce(item->>'item_id','') !~ '^[a-z0-9-]{1,80}$' OR jsonb_typeof(item->'unit_price') IS DISTINCT FROM 'number' OR
     jsonb_typeof(item->'qty') IS DISTINCT FROM 'number' OR (item->>'qty') !~ '^[1-9][0-9]{0,2}$' OR (item->>'qty')::integer>100 OR
     jsonb_typeof(item->'modifiers') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'modifiers')>20 THEN RAISE EXCEPTION 'FULL_CHECKOUT_ITEM_REQUIRED'; END IF;
  mods:='[]';
  FOR modifier IN SELECT value FROM jsonb_array_elements(item->'modifiers') LOOP
   IF jsonb_typeof(modifier) IS DISTINCT FROM 'object' OR
     (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(modifier) k) IS DISTINCT FROM ARRAY['delta','id','name'] OR
     jsonb_typeof(modifier->'id') IS DISTINCT FROM 'string' OR coalesce(modifier->>'id','') !~ '^[a-z0-9-]{1,80}$' OR
     jsonb_typeof(modifier->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(modifier->'delta') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'FULL_CHECKOUT_MODIFIER_REQUIRED'; END IF;
   mods:=mods||jsonb_build_array(jsonb_build_object('id',modifier->'id'));
  END LOOP;
  n:=n+1;
  INSERT INTO master_wok_event_test.full_checkout_items VALUES(p_route,p_request,n,item);
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',item->'item_id','qty',item->'qty','modifiers',mods));
 END LOOP;
 -- Event/booking command IDs must not expose the browser idempotency key.
 event_request:='full-'||encode(sha256(convert_to(p_route::text||':'||p_request,'UTF8')),'hex');
 IF o->>'order_type'='delivery' THEN
  result:=master_wok_event_test.create_delivery_booking(r.current_stream,event_request,p_order,alias,target,lines,NULL);
 ELSE
  result:=master_wok_event_test.create_booking(r.current_stream,event_request,p_order,alias,target,lines);
 END IF;
 IF result<>'RECORDED' THEN RAISE EXCEPTION 'FULL_CHECKOUT_RECEIPT_CONFLICT'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.submit_full_checkout(uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
