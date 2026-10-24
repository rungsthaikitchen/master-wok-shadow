-- PREPARED ONLY. Staging hvrqgufqjslvgiohgkvu; never production.
-- New identities preserve the previous trial history. Conflicts fail; no upsert/reset.
BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL TIME ZONE 'UTC';
DO $fixture$ BEGIN
 IF (clock_timestamp() AT TIME ZONE 'Europe/London')::date>'2026-10-25'::date THEN RAISE EXCEPTION 'FIXTURES_EXPIRED'; END IF;
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('d8316d40-dba5-5cfc-9b3b-b1b6b44757c5','2026-10-25',true),('76233fa7-6e66-544c-ba50-8e072954d6a0','2026-10-25',false);
 PERFORM master_wok_event_test.create_booking('d8316d40-dba5-5cfc-9b3b-b1b6b44757c5','cutover-create-before','05a2a236-2e3e-5656-9567-91e54947f5d0','synthetic-cutover-before','2026-10-25T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='d8316d40-dba5-5cfc-9b3b-b1b6b44757c5';
 ASSERT (SELECT event_count=1 AND NOT enabled FROM master_wok_event_test.streams WHERE id='d8316d40-dba5-5cfc-9b3b-b1b6b44757c5');
 ASSERT (SELECT event_count=0 AND NOT enabled FROM master_wok_event_test.streams WHERE id='76233fa7-6e66-544c-ba50-8e072954d6a0');
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('31cbc165-7d89-5c45-b636-111169870599','2026-10-25',true),('d75a6760-875c-5a87-8249-ce6501b04b1b','2026-10-25',false);
 PERFORM master_wok_event_test.create_booking('31cbc165-7d89-5c45-b636-111169870599','cutover-create-after','e853a4eb-579e-57c0-9713-bbcf7fa82fd2','synthetic-cutover-after','2026-10-25T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='31cbc165-7d89-5c45-b636-111169870599';
 ASSERT (SELECT event_count=1 AND NOT enabled FROM master_wok_event_test.streams WHERE id='31cbc165-7d89-5c45-b636-111169870599');
 ASSERT (SELECT event_count=0 AND NOT enabled FROM master_wok_event_test.streams WHERE id='d75a6760-875c-5a87-8249-ce6501b04b1b');
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('826a5959-b663-5f87-8c1d-4ae5632703f1','2026-10-25',true),('8124b620-8152-51a4-89f4-73df3224bccb','2026-10-25',false);
 PERFORM master_wok_event_test.create_booking('826a5959-b663-5f87-8c1d-4ae5632703f1','cutover-create-rollback','51814786-c024-5267-8c48-65e6bac8ab5b','synthetic-cutover-rollback','2026-10-25T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='826a5959-b663-5f87-8c1d-4ae5632703f1';
 ASSERT (SELECT event_count=1 AND NOT enabled FROM master_wok_event_test.streams WHERE id='826a5959-b663-5f87-8c1d-4ae5632703f1');
 ASSERT (SELECT event_count=0 AND NOT enabled FROM master_wok_event_test.streams WHERE id='8124b620-8152-51a4-89f4-73df3224bccb');
 INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('5ef97bb9-d8d0-5eb7-949d-f96bf8514a97','2026-10-25',true),('5955a3b6-ff96-5df1-8520-8f462af3651c','2026-10-25',false);
 PERFORM master_wok_event_test.create_booking('5ef97bb9-d8d0-5eb7-949d-f96bf8514a97','cutover-create-timeout','882a8cd1-5dd8-58e8-8461-3dad75c54d0a','synthetic-cutover-timeout','2026-10-25T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]');
 UPDATE master_wok_event_test.streams SET enabled=false WHERE id='5ef97bb9-d8d0-5eb7-949d-f96bf8514a97';
 ASSERT (SELECT event_count=1 AND NOT enabled FROM master_wok_event_test.streams WHERE id='5ef97bb9-d8d0-5eb7-949d-f96bf8514a97');
 ASSERT (SELECT event_count=0 AND NOT enabled FROM master_wok_event_test.streams WHERE id='5955a3b6-ff96-5df1-8520-8f462af3651c');
END $fixture$;
COMMIT;
-- All eight streams are disabled at commit. A separate reviewed enable is required.
