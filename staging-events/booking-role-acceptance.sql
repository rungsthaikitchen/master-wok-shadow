-- Catalog assertions only: no admin role-membership changes or impersonation.
DO $$
DECLARE r text:='master_wok_event_writer_login';
BEGIN
 ASSERT NOT has_table_privilege(r,'public.orders','UPDATE');
 ASSERT NOT has_column_privilege(r,'master_wok_event_test.streams','enabled','UPDATE');
 ASSERT NOT has_column_privilege(r,'master_wok_event_test.booking_rows','preferred_time','UPDATE');
 ASSERT NOT has_table_privilege(r,'master_wok_event_test.booking_rows','DELETE');
 ASSERT NOT has_table_privilege(r,'master_wok_event_test.booking_items','UPDATE');
 ASSERT has_column_privilege(r,'master_wok_event_test.booking_rows','proposed_time','UPDATE');
 ASSERT has_function_privilege(r,'master_wok_event_test.create_booking(uuid,text,uuid,text,timestamptz,jsonb)','EXECUTE');
 ASSERT has_function_privilege(r,'master_wok_event_test.apply_booking(uuid,text,uuid,text,timestamptz,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','master_wok_event_test.apply_booking(uuid,text,uuid,text,timestamptz,text)','EXECUTE');
END $$;
SELECT 'NARROW_ROLE_PRIVILEGES_PASSED' AS result;
