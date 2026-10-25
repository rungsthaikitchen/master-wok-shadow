-- Retain private audit fixtures; disable capacity and remove all temporary access.
UPDATE master_wok_event_test.streams SET enabled=false WHERE id IN ('69767040-0e4b-5f37-9ede-3d30cf328e07','14120c87-2ed3-5cf6-91e3-4c5111a9e3b5','fb8af998-31a1-5f71-8e9f-ef8ac9b1723c','b785e4b2-49e8-5a23-b337-adf0066f10f8','aab12160-f85f-5a6a-933d-72a443051e5c');
REVOKE SELECT ON master_wok_event_test.command_routes FROM master_wok_event_writer_login;
REVOKE ALL ON master_wok_event_test.full_checkout_quotes,master_wok_event_test.full_checkout_submissions,master_wok_event_test.full_checkout_orders,master_wok_event_test.full_checkout_items FROM master_wok_event_writer_login;
REVOKE EXECUTE ON FUNCTION master_wok_event_test.submit_full_checkout(uuid,text,uuid,uuid,jsonb),master_wok_event_test.validate_full_checkout_object(jsonb,text,text) FROM master_wok_event_writer_login;
