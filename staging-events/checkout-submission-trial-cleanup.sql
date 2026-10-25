-- Private synthetic staging shutdown; preserve history.
UPDATE master_wok_event_test.streams SET enabled=false WHERE id=ANY(ARRAY['37735660-7f83-556b-a52f-9b384f91f51a'::uuid,'9e8deb43-982a-56ce-9ad7-ecb54b2d4396'::uuid,'d598f4bd-6cee-54cf-a0dd-6db60be3fff5'::uuid,'19ba1f0b-f5ed-5062-9883-3703ced063e2'::uuid,'af9432e0-3ece-547b-98fd-230d54301d7e'::uuid]);
REVOKE SELECT ON master_wok_event_test.command_routes,master_wok_event_test.checkout_quotes FROM master_wok_event_writer_login;
REVOKE SELECT,INSERT ON master_wok_event_test.checkout_submissions FROM master_wok_event_writer_login;
REVOKE EXECUTE ON FUNCTION master_wok_event_test.submit_checkout(uuid,text,uuid,uuid,jsonb) FROM master_wok_event_writer_login;
