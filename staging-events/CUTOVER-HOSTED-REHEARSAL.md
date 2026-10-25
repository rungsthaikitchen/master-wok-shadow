## Hosted concurrency and recovery passed — 25 October 2026

The previously blocked direct-session witness has now run on the existing Railway staging service and Supabase staging project hvrqgufqjslvgiohgkvu. Reviewed build e1d0c13e85212322c751bd769862708efbefd2fa first deployed disabled as f803b0e5-0a57-4442-b301-827dcc455dc9, with DISABLED/sourceRequests=0 observed. Hosted fixture preparation passed once under ROLLBACK, then committed four fresh synthetic bookings with all eight streams disabled. Restricted role checks passed: neither runtime role can seed or enable streams; only the writer can apply bookings. No grants changed.

Enabled deployment 2adcc33f-7644-497a-abfb-13cd58752792 completed successfully. Its 06:31:52 UTC terminal OBSERVED evidence establishes actual database session blocking through pg_blocking_pids, not merely parallel connector requests:

- Before: seed was blocked by the writer; the writer committed and its communicated proposal revision appeared in the new baseline.
- After: writer was blocked by the seed; the reader saw only committed pre-cutover state; after seed commit, the old-source writer was refused SOURCE_DISABLED.
- Rollback: writer was blocked by the seed; the reader saw no partial baseline; after seed rollback the writer recorded successfully. A later seed with the rolled-back request ID returned RECORDED, then ALREADY_RECORDED on exact retry.
- Timeout: real lock contention raised PostgreSQL 55P03; no partial event remained, and one retry with the same request ID returned RECORDED with exactly two source events.

Budget used: started=1, writes=5 of 6, state/metadata reads=7 of 7, probes=65 of 180. Administrative seed calls stayed external to the restricted runner. All data were fixed synthetic staging fixtures; provider calls, notifications and production writes were zero. Frozen reservations in disabled streams are retained audit history, not active kitchen commitments.

The actual exports are fixtures/cutover-concurrency-hosted-25-oct.json; the structured witness and cleanup evidence is cutover-concurrency-hosted-results.json. Two new Python tests pass in each of Europe/London and UTC. They replay all four actual exports through the real Node bridge and persistent journal, inject an ACK interruption, restart/retry, reject duplicate work, snapshot and restore. The three cutover baselines have zero reconstructed historical decisions and retain historicalDecisionCoverage=false; the timeout stream contains exactly one retried decision. All engine results remain verified=false.

Cleanup deployment 6c1e021e-9acb-47a9-ad63-777aafbfa73d reached SUCCESS and emitted DISABLED/sourceRequests=0. The enabled flag is false and its deadline is 0. Independent staging SQL confirms enabled_streams=0 and active_reservations=0. The existing service now retains the reviewed cutover image/command as its disabled one-shot baseline, with restart NEVER and the existing /data volume. The earlier backend credential trial command remains a recovery reference, not an enabled workload. No production source or runtime flag changed; no infrastructure was created. No environment patch was pending at the initial inspection.

Remaining gates: this witness does not prove full live booking-handler coverage, connected-stream router/observer handover, or reliable production decision-event capture. Those integration gates must be completed before claiming a verified comparison against actual booking decisions. Current production polling remains current-state evidence, not historical decision coverage. The sections below are retained as historical preparation and earlier blocker records.

## Local validation completed — 24 October

The refreshed fixture SQL now runs successfully against the pinned PGlite 0.3.14 PostgreSQL engine. New checks execute the real setup, booking, cutover and export functions and the runner's exact preflight query. They verify disabled setup, duplicate refusal without resetting history, rollback of earlier pairs on a later identity conflict, expiry refusal, and one held commitment after offer/baseline/acceptance. Local tests substitute only a moving database clock to keep this intentionally expiring fixture pack reproducible; no provider or production database is contacted.

Results: 28 Node test entries pass in each of Europe/London and UTC (the new eight entries plus the existing 20 cutover baseline entries), with zero failures/skips. Eleven focused Python runner safety/budget tests pass, including preflight state refusal and a deadline crossing fixture expiry. Tests do not establish simultaneous sessions, database lock contention, hosted role ACLs or deployed handler coverage. Those remain hosted rehearsal gates. No Railway configuration, Supabase data, live scheduling, or enabled observer changed.

## 24 October preparation update — not deployed or executed

The refreshed runner and `cutover-concurrency-fixtures-25-oct.sql` now use service day 25 October, twelve new source/destination/booking identities, fresh advisory markers and `/data/cutover-trial-25-oct-v1`. Existing fixture rows and durable attempt markers are retained. The SQL prepares four bookings transactionally, leaving all eight streams disabled at commit; identity conflicts fail rather than replacing history. This SQL has not been executed or validated on hosted PostgreSQL yet. It must only be run against staging hvrqgufqjslvgiohgkvu after project identity verification.

The enabled runner refuses expired service dates or an elapsed 19:15 UTC offer target before inspecting DSNs or opening connections. Its deadline must end strictly before that target. Before opening any writer, one bounded read verifies all eight stream identities, service dates, scope, enabled states and initial counts (one per source, zero per destination). This preflight uses the existing reader permissions; no grants change. The read budget is seven: one metadata preflight plus the six existing state reads. It remains disabled by default. October 25 is after the UK clock change: 18:00Z and 19:15Z are also 18:00 and 19:15 Europe/London. Any later refresh must update both runner and matching SQL; do not enable this pack after expiry.

Before hosted use: inspect current streams and staging service settings; apply/check the new fixture SQL while disabled; confirm counts source=1/destination=0 and all dates/identities; deploy the runner disabled; then explicitly enable only the eight reviewed streams with the bounded runner deadline. The four synchronization cases and cleanup requirements below still apply, using the new CASES markers instead of the historical marker values printed below. Successful local tests are not proof of real database lock overlap. No production activation or key retirement follows from this preparation.

# Hosted cutover rehearsal — partial completion

Subsequent two-date source work is documented in CUTOVER-PAIR-REVIEW.md. It adds the shared snapshot helper and paired producer, hosted rollback evidence and durable paired-baseline tests. The Railway concurrency deployment described below remains blocked; the earlier rehearsal record is retained.

21 October 2026. Private staging project hvrqgufqjslvgiohgkvu only. No production Supabase writes, scheduling/checkout changes, new infrastructure, runtime grants or Railway deployments occurred.

## Installed and verified

Before installation, the hosted record/export function bodies exactly matched the reviewed originals and there were zero enabled private event streams. Two staging migrations succeeded:

- master_wok_private_cutover_record_export_candidate
- master_wok_private_cutover_seed_candidate

They install the reviewed candidate definitions from cutover-record-export.sql and cutover-baseline-store.sql. Seed remains SECURITY INVOKER, with execution revoked from PUBLIC, anon, authenticated and service_role. Catalog checks confirm the existing reader and writer logins are non-superuser/non-bypass, connection limit two, cannot invoke seed and cannot update streams.enabled. Reader retains export only; writer retains apply_booking and cannot export. No membership or role grant was expanded.

cutover-hosted-rollback.sql executed successfully on PostgreSQL 17.11. An exception immediately after seed rolled back destination events, bookings and receipts and left the source enabled. A subsequent successful seed had the correct coverage and offer revision; exact retry returned ALREADY_RECORDED. The enclosing transaction was rolled back, including all fixture rows.

cutover-hosted-lifecycle.sql also passed, entirely under rollback. It captured a current offer, accepted it without adding a second reservation, replaced the offer, refused an acceptance referring to the old revision, rejected the replacement and completed the now-unreserved order. Destination event_count was five; no reservation remained. The actual export is fixtures/cutover-baseline-staging-capture.json: one baseline, one future booking decision and zero final commitments. It is synthetic and contains no customer data. Actual replay passes and never claims coverage of earlier decisions.

Security advisors returned only two pre-existing INFO notices for inaccessible master_wok_delivery_test tables with RLS and no policies. The candidate adds no tables or permissive policies. Advisory reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .

## Concurrency is NOT yet verified

A management-connector experiment submitted a paused writer and attempted to observe it through other SQL calls. The writer committed successfully, but no overlapping active session was observed. It did not reach the seed step. This is not evidence of a concurrency pass or a row-lock failure.

A direct-connection witness was therefore prepared in railway-shadow/event_cutover_trial.py and committed as 4c8dab747ffa7727dbea51cc770249edcd81027a. It uses existing restricted staging writer and reader DSNs, never an administrative credential. Seed stays on the management connection. Fixed advisory-lock markers let the reader identify the seed backend through pg_locks; pg_blocking_pids establishes actual blocking direction without reading another session's query text. A reader snapshot checks that an uncommitted seed never leaks partial destination history.

The runner is default off, fixed to the existing staging project/environment/service and four synthetic fixture pairs, with a ten-minute enable deadline, durable start-once budget, at most six write attempts, six state exports and 180 bounded probes. All other event, monitor and trial flags must explicitly be false. Neither reader nor writer is allowed seed execution or stream enablement. It checks role restrictions again on actual connections. SQL is parameterized and bound to synthetic cases. It exposes no HTTP endpoint, does not call routes or object storage and does not log DSNs or raw database errors.

Four intended cases are prepared: committed writer enters baseline; writer behind committed cutover is refused SOURCE_DISABLED; writer behind rolled-back cutover proceeds; lock timeout leaves no partial event and the same request can retry once. These provider cases have NOT run.

## Railway blocker and cleanup

Railway read access worked, but all three staged-write requests (variables, start command, pinned source) returned UNAUTHENTICATED / invalid authentication credentials. None succeeded. A subsequent get-service-config confirmed no staged changes, the original start command python railway-shadow/event_runtime_staging.py and pinned code 20d9dc996feca8c077ab8e6922d5fc4f61e223c3. Existing cleanup deployment remains 80e725d2-3376-4ead-9f27-5b3cb9dfa57c, last independently observed SUCCESS. No new deployment was started and no approval form is pending.

The eight direct-concurrency fixture streams were explicitly disabled after the authentication failure. A read-only global check confirmed enabled_streams=0 and active_reservations=0. Four frozen synthetic reservations remain in the disabled sources for audit/resume; they must not be counted as active kitchen commitments. The unsuccessful overlap experiment contributed a real synthetic offer to the writer-before source; it is preserved rather than silently deleted. No cutover baseline was committed in those fixture streams.

## Resume checklist

1. Restore Railway connector write authentication; no additional user approval for the agreed staging rehearsal is needed. Inspect pending changes again before deploying anything.
2. Verify or regenerate the fixed synthetic fixtures and targets if the service day has passed. Never blindly re-enable old fixtures. Current runner targets 22 October 2026. Revalidate the corresponding identities and expected event counts.
3. Deploy the reviewed runner disabled on the existing staging service, with no public domain, restart NEVER and existing volume. Observe DISABLED/sourceRequests=0 before a bounded enable.
4. Enable the exact fixture pairs and runner with a fresh deadline. When it emits WAITING_FOR_ADMIN/before, management must acquire pg_advisory_xact_lock(2110202601::bigint), call seed on CASES[0] and commit. The writer releases only after it witnesses seed blocked behind its own backend, then checks the new baseline revision.
5. When it emits WAITING_FOR_ADMIN/after, management must seed CASES[1], acquire pg_advisory_xact_lock(2110202602::bigint), hold the transaction for twenty seconds and COMMIT. When rollback phase is ready, do the same with CASES[2] and marker 2110202603, but ROLLBACK. The timeout case runs autonomously afterward. Each statement needs explicit bounded timeouts. The advisory marker is a synchronization aid, not an event timestamp or reservation.
6. Verify the provider evidence and exports, then test seed retry after the rolled-back writer. Persist/replay the captured baseline through the real journal and recovery path. A passing witness does not itself test router/observer handover.
7. Disable all fixtures and trial flags, restore the original disabled runtime start command and confirm terminal deployment state plus disabled logs. Retain the immutable test history and evidence. Do not grant seed to the worker to work around authentication.

Connected-stream cutover and exact deployed production writer coverage remain separate dependencies. This rehearsal is not a production capture activation.

Local verification: all 88 Python event tests pass, including six new runner safety/budget tests. The actual hosted export adds one staging replay check; the focused staging suite now has 39 passing entries in both timezones. The unchanged core engine's prior 191 tests in each timezone remain the baseline. No concurrency case is counted as passed.
