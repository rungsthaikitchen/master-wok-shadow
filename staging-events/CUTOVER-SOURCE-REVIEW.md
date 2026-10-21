# Source cutover capture candidate

21 October 2026. Private synthetic candidate only. Tested locally against PGlite's PostgreSQL engine. No hosted Supabase SQL mutations, Railway changes, new infrastructure or production hooks were performed for this change. No runtime execution grants were added.

## Behaviour

`cutover-baseline-store.sql` adds an invoker-only administrative `seed_cutover_baseline(source,destination,request)` candidate. It requires distinct enabled synthetic streams with the same service date and a completely empty destination. Both stream rows are locked in UUID order, matching the existing move lock order. Existing synthetic handlers lock the stream before changing rows, baskets or reservations; this is a required writer protocol, not protection against privileged SQL bypassing the protocol.

Within the transaction it validates booking status, authoritative reservation projection, complete baskets and explicit effective targets. Proposed offers retain their current revision. Confirmed reservations retain one hold with no offer revision. A pending request's provisional hold retains its create-event revision, but its booking status remains pending: the customer response handler cannot accept it as an offered time. Known declined orders carry no capacity. Completed/cancelled orders do not become baseline commitments or new decisions.

The producer copies the private booking projection, items, active reservations and command receipts, appends the one baseline event at the server clock, then disables the old stream. All changes roll back together. The old projection and history remain frozen for audit and must be excluded from active monitoring/routing; summing old and new projections would double-count. A successful cutover requires the backend's command router and observer identity to switch to the destination. No production router has been changed. Exact cutover retries return ALREADY_RECORDED even after later events; earlier command receipts prevent a retried create/offer from consuming capacity again.

`cutover-record-export.sql` is a full candidate replacement of the reviewed record/export definitions, leaving their original source file unchanged. Export labels only a first-event baseline as saved state at cutover. Record still refuses arbitrary baseline ingress: only the seed function builds it. Later events must be strictly later at millisecond precision. A same-millisecond command fails atomically with CUTOVER_EVENT_BARRIER_REQUIRED and needs a retry using a newly sampled real clock; no artificial timestamp offsets are added. Baseline offer revision IDs remain reserved against reuse as later event IDs. Status-only closure recognises known unreserved baseline orders.

Delivery estimates are preserved exactly, including their original evidence time. No new route lookup, refreshing or claim of actual cooking/driving occurs. Stale estimates remain stale and missing estimates remain missing. The baseline itself creates no comparison observations.

## Refusal and bounds

Missing baskets, mismatched payloads or targets, private fields, unknown statuses, stale/duplicate offer revisions, orphan reservations, active bookings without holds, non-empty destinations and cross-day cloning fail before capture. The candidate limits source booking rows to 1,000, held commitments to 500 and baseline JSON text to 100 KB. The downstream five MB batch limit and full shared Node validation still apply.

Sources containing a cross-date transfer event are deliberately refused with CONNECTED_CUTOVER_REQUIRED. A single-stream operation cannot establish a safe boundary for connected histories; those need a coordinated multi-stream producer. The tested offline pair reducer supporting baseline events does not itself implement that source boundary.

All new functions use SECURITY INVOKER and a fixed search_path. PUBLIC, anon, authenticated and service_role receive no seed execution permission. Existing restricted writer roles are not expanded to copy all lifecycle fields or disable streams. This candidate is an administrative rehearsal tool, not a browser RPC or a production migration.

## Validation

Run `npm ci`, then `npm run test:staging`. PGlite 0.3.14 is a pinned development dependency with a lockfile; it is not used by the deployed Python runtime. The new test file executes the real candidate PL/pgSQL and existing booking handlers inside an isolated in-memory database, rolls back each fixture, exports through the SQL exporter and runs the actual Node validator/replay.

19 test entries (18 cases plus their parent) pass for the source candidate, covering successful baseline plus later lifecycle, rollback after injected failure, incomplete/private/inconsistent inputs, stale responses, pending versus offered holds, original command retries, delivery evidence preservation, strict clock boundary, destination/scope guards, connected-history refusal and default-denied function execution.

Full checks pass: 191 core Node tests and 38 staging Node entries in both Europe/London and UTC, plus 82 Python event tests. No cases were skipped. These are local PostgreSQL execution and existing offline durability tests; PGlite is single-connection and does not prove multi-session lock contention, hosted role ACLs or Supabase provider behaviour.

## Next rehearsal and production dependencies

1. Review/install the candidate definitions only in the private staging schema, with no runtime grants or production connection.
2. Exercise two real PostgreSQL sessions: a writer completing before the lock must appear in the baseline; one waiting behind cutover must receive SOURCE_DISABLED. Test opposed lock acquisition, failure/rollback, timeout/retry and consistent reader snapshots. Verify restricted roles still cannot invoke seed or re-enable old streams. Existing roles/grants are not presumed sufficient.
3. Rehearse command-router and observer-identity handover, including a real durable baseline intake/restart/recovery and cleanup. Until then the source producer remains undeployed.
4. Resolve connected-stream cutover, exact deployed legacy writer/source coverage, and checkout's separate order/item persistence before preparing the production capture diff. Existing order-confirm retrieval and backend repository access gaps remain as recorded in PRODUCTION-CAPTURE-REVIEW.md.

A private synthetic completeness marker proves only the cooperating handlers from the explicit cutover. It cannot establish full production coverage or reconstruct earlier decision history. Live availability, checkout and customer booking decisions remain unchanged.
