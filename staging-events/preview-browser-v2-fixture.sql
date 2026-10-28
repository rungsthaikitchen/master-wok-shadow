-- Candidate only: staging hvrqgufqjslvgiohgkvu. Creates a fresh DISABLED fixture.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT FROM master_wok_event_test.streams WHERE enabled) THEN RAISE EXCEPTION 'OTHER_STREAM_ENABLED'; END IF; END $$;
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('795f3b0b-08e0-5d22-8071-a97e9cd52912','2026-10-28',true);
INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES('3d31312d-cb9b-53d0-b69b-801b5bbc5698','2026-10-28','795f3b0b-08e0-5d22-8071-a97e9cd52912');
SELECT master_wok_event_test.create_booking('795f3b0b-08e0-5d22-8071-a97e9cd52912','preview-seed-create','7186eb1f-b4a5-5f02-b932-05ebe1303885','synthetic-preview-browser-28-oct-v2','2026-10-28T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]'::jsonb);
SELECT master_wok_event_test.apply_booking('795f3b0b-08e0-5d22-8071-a97e9cd52912','preview-seed-offer','7186eb1f-b4a5-5f02-b932-05ebe1303885','offer','2026-10-28T19:00:00Z',NULL);
UPDATE master_wok_event_test.streams SET enabled=false WHERE id='795f3b0b-08e0-5d22-8071-a97e9cd52912';
COMMIT;
