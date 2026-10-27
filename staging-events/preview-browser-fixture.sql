-- Candidate only: staging hvrqgufqjslvgiohgkvu. Creates a fresh DISABLED fixture.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT FROM master_wok_event_test.streams WHERE enabled) THEN RAISE EXCEPTION 'OTHER_STREAM_ENABLED'; END IF; END $$;
INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES('2d6768d3-3e60-57c2-b9c4-0ce1ae0ebf31','2026-10-28',true);
INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES('ca06cfc7-889b-5732-a723-7f15fe5511ef','2026-10-28','2d6768d3-3e60-57c2-b9c4-0ce1ae0ebf31');
SELECT master_wok_event_test.create_booking('2d6768d3-3e60-57c2-b9c4-0ce1ae0ebf31','preview-seed-create','dddaf759-d42e-5ee0-a15a-1ebc81d04ead','synthetic-preview-browser-28-oct-v1','2026-10-28T18:00:00Z','[{"item_id":"green-curry","qty":1,"modifiers":[{"id":"chicken"}]}]'::jsonb);
SELECT master_wok_event_test.apply_booking('2d6768d3-3e60-57c2-b9c4-0ce1ae0ebf31','preview-seed-offer','dddaf759-d42e-5ee0-a15a-1ebc81d04ead','offer','2026-10-28T19:00:00Z',NULL);
UPDATE master_wok_event_test.streams SET enabled=false WHERE id='2d6768d3-3e60-57c2-b9c4-0ce1ae0ebf31';
COMMIT;
