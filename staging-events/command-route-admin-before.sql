BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='35s'; SET LOCAL TIME ZONE 'UTC';
SELECT pg_advisory_xact_lock(2510202611::bigint);
SELECT master_wok_event_test.switch_command_route('7629f38e-9e24-5478-8413-e0848ef04cd3',0,'24e52bf5-67a6-55fd-a243-d3099eb05577','route-cutover-before');
COMMIT;
SELECT generation,current_stream FROM master_wok_event_test.command_routes WHERE id='7629f38e-9e24-5478-8413-e0848ef04cd3';
