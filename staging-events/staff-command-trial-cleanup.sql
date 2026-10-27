UPDATE master_wok_event_test.streams SET enabled=false WHERE id=ANY(ARRAY['82ad0dea-e101-5280-8007-e78ce026aede'::uuid,'a33121dc-d06e-5a4f-95ef-3403ffe599b6'::uuid,'161f33aa-483a-537b-a3dd-19f65f64d65f'::uuid,'f29b56e5-96dc-52d0-a7b6-cb572dac711a'::uuid,'aa10e3cf-eb0d-5d60-9788-abb2683fde48'::uuid,'3d36abc8-c9dd-57dc-a724-b1e99f2bb2fd'::uuid]);
REVOKE SELECT ON master_wok_event_test.command_routes FROM master_wok_event_writer_login;
REVOKE EXECUTE ON FUNCTION master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid),master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz) FROM master_wok_event_writer_login;
REVOKE ALL ON master_wok_event_test.staff_commands FROM master_wok_event_writer_login,master_wok_event_reader_login;
