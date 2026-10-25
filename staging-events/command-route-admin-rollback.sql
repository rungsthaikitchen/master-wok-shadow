BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='35s'; SET LOCAL TIME ZONE 'UTC';
SELECT master_wok_event_test.switch_command_route('b98c1016-36cc-5106-b3e5-ea796e07475e',0,'2093afac-837b-5fcf-b51a-ff22131c31cf','route-cutover-rollback');
SELECT pg_advisory_xact_lock(2510202613::bigint);
SELECT pg_sleep(12);
ROLLBACK;
SELECT generation,current_stream FROM master_wok_event_test.command_routes WHERE id='b98c1016-36cc-5106-b3e5-ea796e07475e';
