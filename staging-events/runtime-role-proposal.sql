-- Approved grant definition, applied 19 October 2026 in staging hvrqgufqjslvgiohgkvu only.
-- User explicitly approved separate reader/writer logins and Railway credential storage.
-- Login/password activation happened privately after these grants; no credentials are recorded here.
CREATE ROLE master_wok_event_reader_login NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;
GRANT USAGE ON SCHEMA master_wok_event_test TO master_wok_event_reader_login;
GRANT SELECT ON master_wok_event_test.streams,master_wok_event_test.events TO master_wok_event_reader_login;
GRANT EXECUTE ON FUNCTION master_wok_event_test.export(uuid) TO master_wok_event_reader_login;
CREATE POLICY login_reader_streams ON master_wok_event_test.streams FOR SELECT TO master_wok_event_reader_login USING(scope='SYNTHETIC_STAGING_EVENTS');
CREATE POLICY login_reader_events ON master_wok_event_test.events FOR SELECT TO master_wok_event_reader_login USING(EXISTS(SELECT FROM master_wok_event_test.streams s WHERE s.id=stream_id AND s.scope='SYNTHETIC_STAGING_EVENTS'));
ALTER ROLE master_wok_event_reader_login SET default_transaction_read_only=on;
CREATE ROLE master_wok_event_writer_login NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;
GRANT USAGE ON SCHEMA master_wok_event_test TO master_wok_event_writer_login;
GRANT SELECT ON master_wok_event_test.streams,master_wok_event_test.events,master_wok_event_test.reservations,master_wok_event_test.orders,master_wok_event_test.commands TO master_wok_event_writer_login;
GRANT UPDATE(event_count,last_at) ON master_wok_event_test.streams TO master_wok_event_writer_login;
GRANT INSERT ON master_wok_event_test.events,master_wok_event_test.reservations,master_wok_event_test.commands TO master_wok_event_writer_login;
GRANT UPDATE(commitment,proposal_event_id,order_payload) ON master_wok_event_test.reservations TO master_wok_event_writer_login;
GRANT DELETE ON master_wok_event_test.reservations TO master_wok_event_writer_login;
GRANT UPDATE(status) ON master_wok_event_test.orders TO master_wok_event_writer_login;
GRANT EXECUTE ON FUNCTION master_wok_event_test.handle(uuid,text,jsonb),master_wok_event_test.record(uuid,jsonb) TO master_wok_event_writer_login;
-- Table ACLs above constrain the operations even though these policies allow rows
-- within the isolated synthetic schema. No privileges on public RTK tables.
CREATE POLICY login_writer_streams ON master_wok_event_test.streams TO master_wok_event_writer_login USING(scope='SYNTHETIC_STAGING_EVENTS') WITH CHECK(scope='SYNTHETIC_STAGING_EVENTS');
CREATE POLICY login_writer_events ON master_wok_event_test.events TO master_wok_event_writer_login USING(true) WITH CHECK(true);
CREATE POLICY login_writer_reservations ON master_wok_event_test.reservations TO master_wok_event_writer_login USING(true) WITH CHECK(true);
CREATE POLICY login_writer_orders ON master_wok_event_test.orders TO master_wok_event_writer_login USING(true) WITH CHECK(true);
CREATE POLICY login_writer_commands ON master_wok_event_test.commands TO master_wok_event_writer_login USING(true) WITH CHECK(true);
-- After approval: set fresh generated password verifiers and LOGIN for these
-- two roles, then put their separate DSNs in Railway service-only variables.
-- Do not commit plaintext passwords or instantiated provisioning statements.
