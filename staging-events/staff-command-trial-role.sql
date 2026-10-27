-- Temporary synthetic trial ACLs; no public grants, enabled-bit or route mutation.
GRANT SELECT ON master_wok_event_test.command_routes TO master_wok_event_writer_login;
GRANT EXECUTE ON FUNCTION master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid),master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz) TO master_wok_event_writer_login;
GRANT SELECT ON master_wok_event_test.staff_commands TO master_wok_event_writer_login,master_wok_event_reader_login;
GRANT INSERT ON master_wok_event_test.staff_commands TO master_wok_event_writer_login;
CREATE POLICY staff_trial_read ON master_wok_event_test.staff_commands FOR SELECT TO master_wok_event_reader_login,master_wok_event_writer_login USING(route_id=ANY(ARRAY['c64e353d-130e-5390-b916-285b358faac2'::uuid,'dff0b850-9522-51ee-ba7b-769e14c290b7'::uuid,'661045b2-ce79-5c7e-9bd3-4ac6adcc186d'::uuid,'887f7e0c-b644-556f-99f8-d9c45038e39a'::uuid,'343ac50d-fad5-59a0-838a-b8616b4c5adb'::uuid,'e1d53e64-6d26-5097-b74b-00a7d66dede4'::uuid]));
-- The audit case deliberately fails this final insertion after event/bookings change.
CREATE POLICY staff_trial_insert ON master_wok_event_test.staff_commands FOR INSERT TO master_wok_event_writer_login WITH CHECK(route_id=ANY(ARRAY['c64e353d-130e-5390-b916-285b358faac2'::uuid,'dff0b850-9522-51ee-ba7b-769e14c290b7'::uuid,'661045b2-ce79-5c7e-9bd3-4ac6adcc186d'::uuid,'887f7e0c-b644-556f-99f8-d9c45038e39a'::uuid,'e1d53e64-6d26-5097-b74b-00a7d66dede4'::uuid]));
