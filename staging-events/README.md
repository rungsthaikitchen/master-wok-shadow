# Private Postgres event-source rehearsal

Latest mapping: [full current checkout fields](CHECKOUT-PRODUCTION-FIELD-MAPPING.md), 25 October. The default-off offline adapter preserves private payload values and separates engine input. It is not wired to the website, persistence or production.

Latest result: [restricted hosted atomic checkout rehearsal](CHECKOUT-SUBMISSION-HOSTED-REHEARSAL.md), 25 October. Concurrent submission, HTTP retry and recovery checks passed. The trial is disabled with temporary grants revoked. The supported synthetic shape is not a production checkout replacement.

Latest result: [hosted automatic command routing and observer handover](COMMAND-ROUTE-HOSTED-REHEARSAL.md), 25 October. The bounded synthetic staging trial passed; it is now disabled with temporary runtime grants revoked. Production integration remains incomplete.

Staging project: `hvrqgufqjslvgiohgkvu`. This is a private synthetic backend, not a trigger or callback on `public.orders`. Production and existing staging order rows were not modified.

## Installed and exercised, 19 October 2026

Migration `master_wok_private_synthetic_event_source` installed `master_wok_event_test` with three tables (`streams`, `events`, `reservations`) and two SECURITY INVOKER functions. Streams start disabled. No public RPC, Edge Function, cron or Railway worker was installed. The first migration request expired before execution; a read-only check proved no schema existed, and the second request succeeded.

`record(stream,event)` locks the stream row through transaction completion. It allocates the next contiguous per-stream sequence and updates the reservation projection and event outbox in the same transaction. Event times cannot move backwards. Event IDs deduplicate exact retries and reject conflicting reuse. Offers immediately replace prior targets, even prior confirmations. Acceptance references the current offer ID and confirms the existing reservation; rejection removes it. Stale responses fail before changes commit. Explicit cancellation/completion removes a known reservation. Admission DECLINED is distinct from customer rejection. There is no expiry policy.

`export(stream)` is a single STABLE SQL snapshot of committed state and ordered events. Its watermark is the last captured event timestamp, **not the wall clock or a claim of coverage up to now**. Later events cannot be backdated below it. The SQL aggregate is not paginated or silently truncated. The source is bounded to 1,000 events and 100 KB per event. The receiving adapter imposes a five MB total export limit and full Node schema/coverage validation before intake; malformed or oversized source data refuses the complete batch. SQL validates top-level event/order fields and causal state, but the shared Node validator remains the full basket/delivery contract authority. Do not claim every arbitrary SQL input is fully validated at source.

This rehearsal accepts explicit historical fixture timestamps and synthetic aliases. It proves transaction semantics only; a real backend must stamp events server-side at the locked mutation boundary, derive the order snapshot from trusted rows, cover every mutation path and handle cross-service-date moves. Do not offer this function to browsers or use customer-supplied timestamps as authoritative history.

## Actual evidence

- `acceptance.sql` executed in staging against the installed functions and retained one disabled synthetic stream containing 14 events.
- It checked default disabled behaviour, successful append, exact retry deduplication, stale response rejection, explicit rollback after a successful record call, rejection release, export counts and extra private order-field rejection.
- The real Postgres export was fetched using the management connector's admin session with a SELECT-only query, then fed into `event_postgres_export.ingest_export` and the actual durable journal/Node replay worker.
- Results: 14 events, 1 ACKED batch, 6 persisted comparisons; repeat import ALREADY_QUEUED; local snapshot hash/integrity verified. Five predictions GREEN, one UNVERIFIED (missing delivery readiness). All results remain `verified:false` and synthetic.
- This was a manual connector-to-local export, not a deployed continuous process or proof of restricted-token access. No cloud backup/restore was exercised for this integration.
- Permission queries confirmed RLS on all three tables; no anon table SELECT, no service_role table INSERT; anon/authenticated have no schema USAGE; anon/service_role have no record-function EXECUTE. No enabled streams remain.
- Supabase security advisors returned only INFO notices for RLS without policies on these deliberately inaccessible private tables (and two pre-existing test tables). Default denial is intentional: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy . No permissive policies were added to silence the notice.

## Adapter and tests

`railway-shadow/event_postgres_export.py` is default off, accepts only the staging project, validates a UUID stream identity and uses one fixed parameterized SELECT. It requires an injected transport; it does not read tokens, start a server, schedule polls or call any provider. It binds the durable journal identity to project + stream + synthetic scope, and verifies envelope counts and full input validation before intake.

`test_event_postgres_export.py` checks default-off/production refusal, ordered replay and duplicate intake, truncated counts, wrong scope, private fields and stale responses. `fixture.json` is the synthetic 14-event stream shared by acceptance and receiver tests. All event source/inbox/export tests are run together; see validation below. The prior full baseline was 240 Python tests and 166 Node tests in each of London/UTC; this change adds three Python exporter tests and does not change the Node engine.

## Remaining integration and deployment plan

1. Build an authorized staging backend handler around the transaction boundary and map real admin/customer lifecycle paths. This rehearsal owns its own synthetic reservation table; it is not yet connected to the existing RTK order lifecycle.
2. Provision least-privilege source access to only this private export. Current management read tokens are not proven to access these objects. Prefer a dedicated reader role with the exact schema/table/function grants and RLS policies needed; do not grant backend mutation capabilities to the observer.
3. Install a bounded, default-off background poller on an existing approved staging service, using its dedicated journal identity/path. Add freshness/failure monitoring, retention and off-volume recovery for the event journal before continuous use. No new paid resource/API is needed by these source/receiver tests.
4. Exercise real staging handler → transaction → restricted read transport → inbox → replay, including concurrent responses, rollback and restart. Row locking is implemented; simultaneous multi-session writers were not exercised in this rehearsal.
5. Present the production integration diff separately. Do not backfill created_at as offer time or label final rows complete history. New streams start genuinely empty; a real cutover with outstanding/advance orders requires an explicit baseline contract.

All current production checkout decisions, polling services and live availability remain unchanged. No kitchen plan or synthetic state establishes actual cooking or driver activity.

Validation: all 18 Python event inbox/source/export tests passed in 22.815 seconds. The live staging SQL acceptance block completed successfully, followed by verified export/import and permission checks described above.

The subsequent private handler/reader rehearsal is documented in HANDLER-RESULTS.md. It adds server-stamped synthetic lifecycle handling and actual restricted-role read/write-denial evidence; authenticated runtime endpoints and standalone reader transport remain outstanding.
