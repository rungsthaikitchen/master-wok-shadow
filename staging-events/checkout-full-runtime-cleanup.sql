-- Retain private audit fixtures; disable capacity and remove all temporary access.
UPDATE master_wok_event_test.streams SET enabled=false WHERE id IN ('b7586c17-edaf-5a89-8252-d3f7aed57ca0','80987831-64af-5631-8645-db0c5aa854a0','0dfbdcc1-d7b4-598e-b6b3-d22a10f871fb','ff131c05-49b9-5a4b-b86c-6084fae403df','49a715e6-036e-5b49-8e8a-d80eedfb5b76');
REVOKE SELECT ON master_wok_event_test.command_routes FROM master_wok_event_writer_login;
REVOKE ALL ON master_wok_event_test.full_checkout_quotes,master_wok_event_test.full_checkout_submissions,master_wok_event_test.full_checkout_orders,master_wok_event_test.full_checkout_items FROM master_wok_event_writer_login;
REVOKE EXECUTE ON FUNCTION master_wok_event_test.submit_full_checkout(uuid,text,uuid,uuid,jsonb),master_wok_event_test.validate_full_checkout_object(jsonb,text,text) FROM master_wok_event_writer_login;
