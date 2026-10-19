# Durable staging event capture and replay worker

This is the receiving inbox and comparison worker for complete event batches. It is **not yet a live backend hook, authoritative source outbox, remote API or deployed monitoring service**. The fixed integration runner accepts only the committed synthetic service fixture and refuses Railway context and source/provider credentials. No booking or Supabase client exists in these modules.

## Files and flow

- `railway-shadow/event_capture_journal.py`: dedicated SQLite intake, leases, redacted comparison persistence and local snapshot/restore.
- `railway-shadow/event_capture_staging.py`: default-off, local fixed-fixture integration runner.
- `railway-shadow/test_event_capture_journal.py`: end-to-end and failure tests using the actual Node replay engine.
- `master-wok-chronological-replay.js`: shared `validateEventBatch` contract; validation-only CLI path does not invoke kitchen scheduling.

1. A background adapter receives a complete event batch satisfying CHRONOLOGICAL_REPLAY.md. It validates the schema, coverage and ordering, then enqueues it durably. Never invoke or await this background adapter inside checkout.
2. SQLite intake commits immutable source events and a deduplicated pending batch in one transaction. Incoming content cannot overwrite a captured sequence/event ID. A batch cannot insert additional events before a previously complete source watermark. One journal is bound to one source identity, synthetic scope and service date.
3. The worker claims a sixty-second lease, runs the real Node kitchen replay in a restricted environment with Europe/London timezone, and checks the returned decision identities against the captured input.
4. Redacted observation records, batch membership and ACKED state commit together. An exception before commit rolls all of them back. A stale lease token cannot acknowledge a new owner's work.
5. Retries are bounded to three attempts. A crash leaves the lease to expire. FAILED batches remain visible in summary output; an idle queue does not imply success when failures exist.
6. A local snapshot is hash/integrity verified and can restore the captured stream, comparisons and queue state into a new directory. This does not provide off-volume disaster recovery; no cloud backup or remote restore was exercised for this new journal format.

## Persistence and privacy

Scope is `SYNTHETIC_STAGING_EVENTS`, with a dedicated `event-capture.sqlite3` file and exclusive process lock. SQLite uses WAL and synchronous FULL. Database/lock files are restricted to owner permissions.

`events` and `batches` contain the minimal pseudonymous basket/time event input, not merely aggregate results. They must remain service-private. `observations` contains no basket lines, customer details, addresses or coordinates. Extra fields outside the shared event contract are rejected before persistence. IDs must be pseudonymized by the future trusted exporter; syntactic validation cannot prove an ID contains no personal information.

Observations are bound to source identity, event ID, engine/runtime build hash and a canonical fingerprint of the source prefix known at that decision. Prefix fingerprints use incremental hashing, avoiding repeated whole-history serialization. Source events and redacted results have independent integrity checks. Later event batches reuse earlier unchanged observations rather than duplicating or rewriting them. A new engine revision creates a separate assessment version and never silently processes pending work as an older revision.

The staging store caps intake at sixteen batches of at most five MiB each. It is a bounded integration component, not a retention policy for an indefinitely running production service. Snapshot restore refuses existing destinations and caps source size at one hundred MB. An interrupted/old snapshot may contain a leased job: allow its lease to expire before reassignment. No restoration code overwrites a live database.

## Local fixed-fixture runner

Disabled by default. Enabling requires:

- `MASTER_WOK_EVENT_CAPTURE_FIXTURE_ENABLED=true`.
- `MASTER_WOK_EVENT_CAPTURE_SCOPE=LOCAL_FIXED_SYNTHETIC_FIXTURE`.
- `MASTER_WOK_EVENT_CAPTURE_DIRECTORY`: an absolute dedicated local directory.

It reads only `fixtures/chronological-synthetic-service.json`; there is no arbitrary input-file option. It enqueues, processes once, creates a verified local snapshot and emits redacted summary counts. A second run reuses the acknowledged batch without adding observations. It refuses Railway project context, the management source token, service-role/database credentials and the staging Google key. No remote resource or paid provider is required.

## Production integration dependencies

A durable receiver does not make non-atomic source capture complete. The authoritative backend must still provide a consistent event stream, stable deduplicated IDs, monotonic per-service sequence, advance-booking coverage and a trustworthy watermark. Do not infer these from final order rows, callback arrival order or notification emails.

The deployed sources use multiple admin/customer paths and different time/status fields. Map actual accept/decline/suggest/customer-confirmation/cancellation/completion transitions explicitly. The unused `mark_paid` path is excluded from this work. Its previously identified defect remains deferred; no patch or UI change is included here.

A real source outbox may require a same-transaction change to backend persistence. Any production Supabase write/migration remains outside current authorization. Before production integration, build and test that source adapter in staging, then present its concrete backend diff. An after-response best-effort callback alone cannot be labelled complete decision history; missing source evidence must stay UNVERIFIED.

The existing abstract Node observer/worker remains unchanged. This component receives complete historical batches, while the older worker contract receives individual pre-decision snapshots. They are different boundaries; do not wire one message shape into the other without an explicit mapping.

Next deployment work also needs a protected background worker runtime, authenticated intake if exposed remotely, failure/freshness monitoring, off-volume recovery for this journal format, retention limits and a review of CPU/volume usage. No endpoint, cron, source hook or remote deployment is enabled by this patch. All recommendations remain hypothetical and never change live booking decisions or establish actual cooking/driver activity.

## Synthetic source transaction prototype

`railway-shadow/event_source_staging.py` adds a default-off local synthetic backend source. It owns a new, initially empty simulated booking store and an outbox in the **same SQLite transaction**. The source assigns contiguous sequences, deduplicates identical event IDs, rejects changed IDs, validates the full bounded history before commit and exports a consistent snapshot under a write lock. Export advances a persisted watermark; subsequent backdated events are refused. Advance bookings remain in the stream. Both intake and export use the shared Node contract.

This is not a deployed Supabase exporter or a hook around remote booking writes. The `bookings` table is a synthetic reservation projection: offers replace the entry, acceptance confirms it, rejection/cancellation remove it, and admission declines preserve any prior entry. It does not represent actual cooking, driver activity or the production status model. Complete coverage applies only to this newly created synthetic source. There is no API, scheduler or network client. The constructor requires explicit enablement and `LOCAL_SYNTHETIC_BACKEND` scope, with a dedicated `synthetic-source.sqlite3` filename.

The four source tests cover state/outbox rollback, idempotency, conflicting IDs, restart, watermark enforcement, private-field rejection and source → durable inbox → real replay integration. Eight source events yield five comparisons. This proves the local transaction/export contract only. Outstanding deployment work: map every real admin/customer transition to a Postgres transaction/outbox, establish initial coverage without claiming historical final rows are event history, pseudonymize source IDs, authenticate background export, and provide monitoring/backup/retention. Production is unchanged; no new runtime was deployed.


Version-bound customer responses are now validated before outbox commit. `proposalEventId` identifies the current offer; a response to an older offer rolls back without a booking change or event. The projection and outbox update share one transaction. Same-ID retries remain idempotent. This is local SQLite evidence, not proof of Postgres concurrency or a deployed backend hook. No automatic expiry is enabled.
