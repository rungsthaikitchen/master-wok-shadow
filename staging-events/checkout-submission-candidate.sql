-- Isolated synthetic candidate. Not installed; no production tables or grants.
-- Quotes are provisioned by the trusted staging administrator, never a browser.
CREATE TABLE master_wok_event_test.checkout_quotes (
 id uuid PRIMARY KEY,
 route_id uuid NOT NULL REFERENCES master_wok_event_test.command_routes(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);
CREATE TABLE master_wok_event_test.checkout_submissions (
 route_id uuid NOT NULL REFERENCES master_wok_event_test.command_routes(id),
 request_id text NOT NULL,
 order_id uuid NOT NULL,
 quote_id uuid NOT NULL UNIQUE REFERENCES master_wok_event_test.checkout_quotes(id),
 origin_stream uuid NOT NULL REFERENCES master_wok_event_test.streams(id),
 command jsonb NOT NULL,
 committed_payload jsonb NOT NULL,
 PRIMARY KEY(route_id,request_id), UNIQUE(route_id,order_id)
);
ALTER TABLE master_wok_event_test.checkout_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_event_test.checkout_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_wok_event_test.checkout_quotes,master_wok_event_test.checkout_submissions FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION master_wok_event_test.submit_checkout(p_route uuid,p_request text,p_order uuid,p_quote uuid,p_checkout jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,master_wok_event_test AS $$
DECLARE r master_wok_event_test.command_routes%ROWTYPE; q master_wok_event_test.checkout_quotes%ROWTYPE;
 prior jsonb; cmd jsonb; keys text[]; line jsonb; modifier jsonb; lines jsonb:='[]'; clean_mods jsonb;
 subtotal bigint:=0; field text; result text;
BEGIN
 IF p_route IS NULL OR p_order IS NULL OR p_quote IS NULL OR coalesce(p_request,'') !~ '^[a-zA-Z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'CHECKOUT_COMMAND_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('master-wok-route:'||p_route::text,0));
 SELECT * INTO STRICT r FROM master_wok_event_test.command_routes WHERE id=p_route;
 -- Same lock order as routed commands: route, then stream. Serializes quote redemption.
 PERFORM 1 FROM master_wok_event_test.streams WHERE id=r.current_stream AND enabled AND scope=r.scope AND service_date=r.service_date FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CURRENT_ROUTE_DISABLED'; END IF;
 cmd:=jsonb_build_object('orderId',p_order,'quoteId',p_quote,'checkout',p_checkout);
 SELECT command INTO prior FROM master_wok_event_test.checkout_submissions WHERE route_id=p_route AND request_id=p_request;
 IF FOUND THEN
  IF prior=cmd THEN RETURN 'ALREADY_RECORDED'; END IF;
  RAISE EXCEPTION 'CHECKOUT_REQUEST_REUSED';
 END IF;
 SELECT * INTO STRICT q FROM master_wok_event_test.checkout_quotes WHERE id=p_quote;
 IF q.route_id<>p_route OR q.payload IS DISTINCT FROM p_checkout THEN RAISE EXCEPTION 'TRUSTED_QUOTE_MISMATCH'; END IF;
 IF q.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CHECKOUT_QUOTE_EXPIRED'; END IF;
 IF EXISTS(SELECT FROM master_wok_event_test.checkout_submissions WHERE quote_id=p_quote) THEN RAISE EXCEPTION 'CHECKOUT_QUOTE_USED'; END IF;
 IF jsonb_typeof(p_checkout) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CHECKOUT_REQUIRED'; END IF;
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(p_checkout) k;
 IF keys IS DISTINCT FROM ARRAY['communication_preference','customer_alias','delivery_fee_pence','discount_pence','lines','order_alias','order_type','payment_preference','preferred_time','subtotal_pence','total_pence'] THEN RAISE EXCEPTION 'CHECKOUT_FIELDS_REQUIRED'; END IF;
 IF coalesce(p_checkout->>'customer_alias','') !~ '^synthetic-[a-z0-9_-]{1,80}$' OR
    coalesce(p_checkout->>'order_alias','') !~ '^synthetic-[a-z0-9_-]{1,80}$' OR
    coalesce(p_checkout->>'order_type','') NOT IN ('collection','delivery') OR
    coalesce(p_checkout->>'payment_preference','') NOT IN ('cash','card') OR
    coalesce(p_checkout->>'communication_preference','') NOT IN ('sms','email') OR
    coalesce(p_checkout->>'preferred_time','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'CHECKOUT_FIELDS_REQUIRED'; END IF;
 FOREACH field IN ARRAY ARRAY['subtotal_pence','discount_pence','delivery_fee_pence','total_pence'] LOOP
  IF jsonb_typeof(p_checkout->field) IS DISTINCT FROM 'number' OR (p_checkout->>field) !~ '^(0|[1-9][0-9]{0,6})$' THEN RAISE EXCEPTION 'CHECKOUT_MONEY_REQUIRED'; END IF;
 END LOOP;
 IF jsonb_typeof(p_checkout->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_checkout->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'COMPLETE_BASKET_REQUIRED'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_checkout->'lines') LOOP
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CHECKOUT_LINE_REQUIRED'; END IF;
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(line) k;
  IF keys IS DISTINCT FROM ARRAY['item_id','modifiers','qty','spice','unit_price_pence'] OR
    jsonb_typeof(line->'unit_price_pence') IS DISTINCT FROM 'number' OR (line->>'unit_price_pence') !~ '^(0|[1-9][0-9]{0,5})$' OR
    jsonb_typeof(line->'qty') IS DISTINCT FROM 'number' OR (line->>'qty') !~ '^[1-9][0-9]{0,2}$' OR (line->>'qty')::integer>100 OR
    jsonb_typeof(line->'modifiers') IS DISTINCT FROM 'array' OR jsonb_array_length(line->'modifiers')>20 OR
    (line->'spice'<>'null'::jsonb AND (jsonb_typeof(line->'spice') IS DISTINCT FROM 'number' OR (line->>'spice') !~ '^[0-3]$')) THEN RAISE EXCEPTION 'CHECKOUT_LINE_REQUIRED'; END IF;
  clean_mods:='[]';
  FOR modifier IN SELECT value FROM jsonb_array_elements(line->'modifiers') LOOP
   IF jsonb_typeof(modifier) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CHECKOUT_MODIFIER_REQUIRED'; END IF;
   SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(modifier) k;
   IF keys IS DISTINCT FROM ARRAY['delta_pence','id'] OR jsonb_typeof(modifier->'delta_pence') IS DISTINCT FROM 'number' OR (modifier->>'delta_pence') !~ '^-?(0|[1-9][0-9]{0,4})$' THEN RAISE EXCEPTION 'CHECKOUT_MODIFIER_REQUIRED'; END IF;
   clean_mods:=clean_mods||jsonb_build_array(jsonb_build_object('id',modifier->'id'));
  END LOOP;
  subtotal:=subtotal+(line->>'unit_price_pence')::bigint*(line->>'qty')::integer;
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',line->'item_id','qty',line->'qty','modifiers',clean_mods));
 END LOOP;
 IF subtotal<>(p_checkout->>'subtotal_pence')::bigint OR
    (p_checkout->>'discount_pence')::bigint>subtotal OR
    (p_checkout->>'total_pence')::bigint<>subtotal-(p_checkout->>'discount_pence')::bigint+(p_checkout->>'delivery_fee_pence')::bigint OR
    (p_checkout->>'order_type'='collection' AND (p_checkout->>'delivery_fee_pence')::integer<>0) THEN RAISE EXCEPTION 'CHECKOUT_TOTAL_MISMATCH'; END IF;
 -- Retains the full supported checkout snapshot including prices/spice. The engine
 -- receives only its allowlist, derived from the same complete basket transaction.
 INSERT INTO master_wok_event_test.checkout_submissions VALUES(p_route,p_request,p_order,p_quote,r.current_stream,cmd,p_checkout);
 IF p_checkout->>'order_type'='delivery' THEN
  result:=master_wok_event_test.create_delivery_booking(r.current_stream,p_request,p_order,p_checkout->>'order_alias',(p_checkout->>'preferred_time')::timestamptz,lines,NULL);
 ELSE
  result:=master_wok_event_test.create_booking(r.current_stream,p_request,p_order,p_checkout->>'order_alias',(p_checkout->>'preferred_time')::timestamptz,lines);
 END IF;
 IF result<>'RECORDED' THEN RAISE EXCEPTION 'CHECKOUT_RECEIPT_CONFLICT'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION master_wok_event_test.submit_checkout(uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
