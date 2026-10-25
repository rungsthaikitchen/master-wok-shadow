-- Dedicated private staging fixtures. All disabled at commit. Never production.
BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL TIME ZONE 'UTC';
DO $f$ BEGIN
 IF (clock_timestamp() AT TIME ZONE 'Europe/London')::date>'2026-10-26'::date THEN RAISE EXCEPTION 'FIXTURES_EXPIRED'; END IF;
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('8269cd25-5959-5263-bba7-1dd2c25df88c','2026-10-26',true),('24e52bf5-67a6-55fd-a243-d3099eb05577','2026-10-26',false);
 INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES('7629f38e-9e24-5478-8413-e0848ef04cd3','2026-10-26','8269cd25-5959-5263-bba7-1dd2c25df88c');
 PERFORM master_wok_event_test.routed_create_booking('7629f38e-9e24-5478-8413-e0848ef04cd3','route-create-before','1862e741-f6e0-531f-9f06-917983e5e54a','synthetic-route-before','2026-10-26T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.routed_apply_booking('7629f38e-9e24-5478-8413-e0848ef04cd3','route-initial-before','synthetic-route-before','offer','2026-10-26T19:00:00Z',NULL,NULL);
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='8269cd25-5959-5263-bba7-1dd2c25df88c';
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('5cf89a7d-436e-511c-b6ae-eb21e21bc245','2026-10-26',true),('458086bb-d9bd-5f57-85cd-b64e8f76c95d','2026-10-26',false);
 INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES('f8da5318-aa1b-54f7-89b5-5a73480ab771','2026-10-26','5cf89a7d-436e-511c-b6ae-eb21e21bc245');
 PERFORM master_wok_event_test.routed_create_booking('f8da5318-aa1b-54f7-89b5-5a73480ab771','route-create-after','e0471000-6210-534a-beed-6e831aac8b43','synthetic-route-after','2026-10-26T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.routed_apply_booking('f8da5318-aa1b-54f7-89b5-5a73480ab771','route-initial-after','synthetic-route-after','offer','2026-10-26T19:00:00Z',NULL,NULL);
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='5cf89a7d-436e-511c-b6ae-eb21e21bc245';
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('18cac038-f114-522c-9784-dc49a16453dd','2026-10-26',true),('2093afac-837b-5fcf-b51a-ff22131c31cf','2026-10-26',false);
 INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES('b98c1016-36cc-5106-b3e5-ea796e07475e','2026-10-26','18cac038-f114-522c-9784-dc49a16453dd');
 PERFORM master_wok_event_test.routed_create_booking('b98c1016-36cc-5106-b3e5-ea796e07475e','route-create-rollback','888ae8d9-8b65-5555-b224-00e3c45e1af0','synthetic-route-rollback','2026-10-26T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.routed_apply_booking('b98c1016-36cc-5106-b3e5-ea796e07475e','route-initial-rollback','synthetic-route-rollback','offer','2026-10-26T19:00:00Z',NULL,NULL);
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='18cac038-f114-522c-9784-dc49a16453dd';
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('68cb8db0-907d-5bf1-b392-2dd1eaa9b6b3','2026-10-26',true),('e2f11d46-6651-5fcb-b20f-966f96adf77f','2026-10-26',false);
 INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES('21fa0874-7578-5288-a60d-0740294e669b','2026-10-26','68cb8db0-907d-5bf1-b392-2dd1eaa9b6b3');
 PERFORM master_wok_event_test.routed_create_booking('21fa0874-7578-5288-a60d-0740294e669b','route-create-timeout','8f5aebc5-1d76-5164-8cb0-b5ca7781e819','synthetic-route-timeout','2026-10-26T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 PERFORM master_wok_event_test.routed_apply_booking('21fa0874-7578-5288-a60d-0740294e669b','route-initial-timeout','synthetic-route-timeout','offer','2026-10-26T19:00:00Z',NULL,NULL);
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='68cb8db0-907d-5bf1-b392-2dd1eaa9b6b3';
END $f$;
COMMIT;
