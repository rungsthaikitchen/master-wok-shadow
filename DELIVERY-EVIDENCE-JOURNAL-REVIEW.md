# Persistent delivery-evidence journal — review, 17 October 2026

Implemented and tested locally. Not committed, deployed or connected to a running source. This follows the successful staging source acceptance at adapter commit 1897caed82b204fedd83bb93190470b3d709bdf3. Existing Railway services, Supabase and live booking decisions are unchanged.

## Scope

The new railway-shadow/delivery_evidence_journal.py provides a dedicated SQLite journal for the redacted saved-state evidence audit. This is not a kitchen schedule, driver movement log, actual arrival log or booking-decision history. It stores only UNVERIFIED / verified:false evidence; recommendation must be null. A strict projection rejects customer data, unexpected fields and suggestions masquerading as confirmed results.

Journal construction and poll_evidence are disabled unless enabled is literally boolean true. No environment variable is wired into an observer, and the module contains no network client or daemon. The eventual caller supplies the already-tested read-only source. The Node child runs only the fixed evidence audit, with runtime secrets omitted from its environment. No Google requests or source/database writes are added.

## Persistence contract

- The absolute filename must be delivery-evidence.sqlite3. Journal and lock permissions are 0600; newly created parent directories are 0700. A nonblocking writer lock refuses concurrent writers.
- A distinct application ID, schema version and immutable project/source identity prevent adopting or mixing an existing kitchen/synthetic database. Existing unknown databases are rejected before journal-mode or schema changes. The original file is not automatically migrated, relabelled or overwritten.
- WAL plus synchronous FULL and foreign keys are enabled. States, poll success, transitions and latest presence commit in one transaction. Success is returned only after that transaction completes.
- State keys bind source identity, service date, audit build hash, complete redacted source-state hash and per-order readiness record. Unchanged repeated snapshots do not create duplicate states; changed input/build revisions remain distinct. Poll timestamps are not part of state identity.
- A->B->A changes retain all transitions while reusing the original A state. Order disappearance creates a MISSING transition with no state key; it never invents cancellation or completion. Reappearance is recorded separately.
- Latest presence is replaced only for the successfully polled service day. Failed polls keep existing presence and history. Other service days are not erased.
- The exact saved source basket is not retained in this journal. Its hash detects source revisions, while the persisted payload contains only the redacted readiness result. This supports evidence monitoring, not retrospective rerunning of cooking plans. A later recommendation journal will need its own reviewed input/provenance contract.

## Health and failure handling

Each required service day must have a successful latest poll. Both the actual poll time and database source observation time must be fresh within 180 seconds; source timestamps more than five seconds ahead are rejected. Stale source data cannot look healthy merely because it was recently written locally. Empty saved-state days can be healthy source polls while prediction stays UNVERIFIED and recommendation stays null.

Fixed failure codes distinguish source, audit, journal and source-clock failures. No raw exception strings are persisted or returned. Read-only health does not create missing databases. The active journal object also remembers a failed poll in memory if the disk cannot record the failure. A standalone reader cannot see an unpersisted failure and may regard the last success as fresh until its 180-second expiry; a future HTTP wrapper must combine process state with journal health, as the object.health method does. No external health endpoint is deployed by this change.

The source project, read-only role and requested service date are checked again before auditing. The audit identity/counts/record contract is validated before a transaction. A source/alias identity change requires a separately reviewed journal migration or new file. Renewing the Management read token does not require changing the private alias key; keep that key stable.

## Backup/restore

backup_to writes a new absolute destination without overwrite, uses SQLite's backup API to include committed WAL data, checks integrity and identity, and fsyncs the file and parent directory. Restore into a separate directory with filename delivery-evidence.sqlite3, using the same source identity/project. A backup/restore test passes. This helper does not schedule backups, copy them off-volume, encrypt them or establish production recovery readiness; those are remaining integration tasks.

## Validation

95 tests pass in the full local Python working suite, including 17 new journal tests. The full local suite includes retained prior development/acceptance tests; the review bundle contains the 17 new journal tests. The unchanged Node suite previously passed 124 entries in Europe/London and UTC; it was not rerun for this Python-only change. The new poll test does execute the actual Node audit from the real Python source normalizer's output.

Coverage includes default-off/no I/O; real source-normalizer -> Node-audit -> journal flow; close/reopen idempotency; rescheduling A->B->A; basket-only source revisions; disappearance/reappearance; per-day isolation and health; stale/future clocks; redacted source failures; transaction rollback; disk failures that prevent error persistence; strict privacy and uncertainty contracts; wrong source/role/date; writer/source/schema guards; immutable conflict rejection; read-only health; backup/restore with WAL; and abrupt process exits both before and after commit. An interrupted uncommitted write leaves prior presence intact; a completed commit survives an immediate os._exit.

No Supabase access, Railway change, Google call, GitHub push or production write occurred during this journal development phase. Tests use temporary local databases and synthetic data.

## Review and integration plan

1. With approval, commit only delivery_evidence_journal.py, test_delivery_evidence_journal.py, this review and TEST-RESULTS-EVIDENCE-JOURNAL-PYTHON.txt to delivery-route-staging from parent 1897caed82b204fedd83bb93190470b3d709bdf3. Leave main and existing runtime pins unchanged. The test imports the already committed test_delivery_shadow_source fixture.
2. Prepare an independently gated staging wrapper with a new private volume and stable source identity. Bind the read-only saved-state source to poll_evidence; use journal.health for current-process failure awareness. Keep real-origin evidence separate from the existing synthetic journal. No public domain or production deployment is included in this approval request.
3. In staging, repeat controlled saved-row acceptance through persistent storage; verify restart/abrupt-stop behaviour, per-day health and off-volume restore. Source test fixtures must remain isolated from current service days and be removed afterwards, as in the completed source acceptance.
4. Review a concrete bounded production-shadow evidence-only deployment separately. Plan token renewal, off-volume backup/restore and private monitoring before rollout. Do not change checkout, availability, order status or confirmed-time values.
5. Real delivery recommendations still require approved directional route evidence and complete dated kitchen/driver commitments. Saved status observations cannot establish original booking decisions or actual kitchen/driver activity. Those dependencies are not solved by durable storage alone.
