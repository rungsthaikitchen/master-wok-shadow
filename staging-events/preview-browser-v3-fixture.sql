-- Candidate only: staging hvrqgufqjslvgiohgkvu. Creates a fresh DISABLED fixture.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT FROM master_wok_event_test.streams WHERE enabled) THEN RAISE EXCEPTION 'OTHER_STREAM_ENABLED'; END IF; END $$;
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('4cbf42dd-4829-5216-b91c-ac4e0d907191','2026-10-29',true);
INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES('97f09d20-db85-5f05-ad93-2087d9f2501e','2026-10-29','4cbf42dd-4829-5216-b91c-ac4e0d907191');
SELECT master_wok_event_test.create_booking('4cbf42dd-4829-5216-b91c-ac4e0d907191','preview-seed-create','5a392c7d-40d9-5a62-adc1-bb0eed873a62','synthetic-preview-browser-29-oct-v3','2026-10-29T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]'::jsonb);
SELECT master_wok_event_test.apply_booking('4cbf42dd-4829-5216-b91c-ac4e0d907191','preview-seed-offer','5a392c7d-40d9-5a62-adc1-bb0eed873a62','offer','2026-10-29T19:00:00Z',NULL);
UPDATE master_wok_event_test.streams SET enabled=false WHERE id='4cbf42dd-4829-5216-b91c-ac4e0d907191';
COMMIT;
