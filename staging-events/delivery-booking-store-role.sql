-- Existing private staging writer only, after candidate delivery functions install.
-- Existing column grants and enabled-synthetic-stream RLS remain unchanged.
GRANT EXECUTE ON FUNCTION master_wok_event_test.delivery_plan_estimate(jsonb,text,jsonb,timestamptz),master_wok_event_test.create_delivery_booking(uuid,text,uuid,text,timestamptz,jsonb,jsonb),master_wok_event_test.apply_delivery_booking(uuid,text,uuid,text,timestamptz,jsonb) TO master_wok_event_writer_login;
