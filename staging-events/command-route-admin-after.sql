BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='35s'; SET LOCAL TIME ZONE 'UTC';
SELECT master_wok_event_test.switch_command_route('f8da5318-aa1b-54f7-89b5-5a73480ab771',0,'458086bb-d9bd-5f57-85cd-b64e8f76c95d','route-cutover-after');
SELECT pg_advisory_xact_lock(2510202612::bigint);
SELECT pg_sleep(12);
COMMIT;
SELECT generation,current_stream FROM master_wok_event_test.command_routes WHERE id='f8da5318-aa1b-54f7-89b5-5a73480ab771';
