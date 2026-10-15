# Master Wok shadow review — 14 October 2026

**15 October update:** backend/frontend source files have since been supplied and statically reviewed. See PRODUCTION-FLOW-REVIEW.md and railway-shadow/README.md for current integration findings and the additional read-only collector. Statements below about missing backend sources describe the earlier review. No live historical dataset or production access has been supplied; exact decision capture remains distinct from polled-state monitoring.

Ready for code review and local/staging integration. NOT connected to live orders, NOT deployed, and NOT a complete persistent live service yet.

## What changed

- Hardened chronological replay: calendar validation, malformed rows, duplicates, deterministic sorting and the 16:30–22:00 production boundary. Advance orders start on the service day. Hypothetically started jobs remain protected; future jobs may move. Once an accepted historical order has no feasible plan, subsequent affected assessments remain UNVERIFIED. No fabricated recovery plan.
- Explicit evidence labels distinguish hypothetical plans, final-time historical replay and actual cooking activity. All replay envelopes remain `verified:false`, even when individual model comparisons are GREEN.
- Hardened disabled-by-default observer: only boolean `true` enables it; copied assessment inputs; safe logging; bounded asynchronous callback waits; failure isolation. Records contain no basket, contact details or exception text.
- Added the Node server assessment adapter, isolated engine context, bounded VM scheduling, menu/quantity validation and fail-safe London timezone requirement.
- Added a durable, append-only record store for a **dedicated shadow volume**. Files are fsynced, atomically linked, directory-fsynced and deduplicated. Conflicting revisions cannot overwrite records. Reopening the store preserves observations. Corruption is surfaced.
- Added an opt-in queue-worker boundary: claim with a lease, persist, then acknowledge. Failed persistence retries; a failed acknowledgement relies on lease expiry and idempotent redelivery. The actual durable queue is an injected backend dependency.
- Added offline replay, fixture-observation and summary commands, fixtures and tests. Fixed original tests to run regardless of working directory.

## Validation performed

Node v24.19.0, no installed dependencies. All six test files pass under `TZ=Europe/London` and `TZ=UTC`: 25 Node runner entries in each run (three legacy files contain multiple assertion scenarios). See TEST-RESULTS-LONDON.txt and TEST-RESULTS-UTC.txt.

Checks include legacy kitchen regressions, paginated loader completeness, chronological/advance orders, protected hypothetical work, invalid inputs, failed-plan uncertainty, disabled operation, throwing/asynchronous loggers, stalled callbacks, snapshot mutation isolation, invalid menu data, concurrent duplicate storage, restart reads, conflict refusal, corruption detection and worker acknowledgement ordering.

Separate-process smoke test: synthetic event persisted twice, then summary read in a third process; exactly one GREEN/ACCEPTED record. The supplied three-order synthetic historical fixture produces three chronological GREEN comparisons while the overall result remains UNVERIFIED. This is synthetic evidence only.

No live historical dataset, backend source, database credentials or production access was supplied. No production database was queried or written. No changes were pushed or deployed.

## Historical replay limits and required data

The historical loader uses final effective times and creation time, not decision-time revisions. Current cancellations, proposed times, late edits, pending/declined statuses and changes to menu definitions can change the reconstruction. Matching row/item counts does not prove a transactionally consistent snapshot. Do not describe the loader's set as proven historical acceptances.

To validate a real day, supply a redacted export of known accepted reservations: opaque order ID, placement timestamp with timezone, ready minute in London service time, and lines `{itemId, qty, mods: []}`. The offline `replay` command accepts that array. For reliable chronological decision reconstruction, additionally supply the authoritative decision/revision log, including cancellation and time-change timing, or label results as final-state approximation. Current replay does not apply a full accept/cancel/revise event stream.

Live adapter input `snapshot.reservations` is a full chronological set of prior accepted commitments, not an unfinished-orders-only list. Entries use `{orderId, placedAt, readyMinute, lines}`. The caller must establish completeness, stable revisions and pre-decision isolation. Set `complete:true` and `basis:'PRE_DECISION_HISTORY'` only when that claim is supportable; otherwise the adapter returns UNVERIFIED. Same-timestamp prior bookings are currently treated as ambiguous and return UNVERIFIED. Revisions/cancellations that invalidate the hypothetical prior timeline must invalidate the snapshot; do not substitute final times into an asserted historical timeline.

`proposed` contains the candidate once. `decisionAt` must be the actual decision instant, not observation/worker execution time. This conservative adapter makes candidate work available at decision time. Capture external requested and decided times separately, and keep them consistent with candidate ready time and service date. UNKNOWN is available for missing authoritative outcomes; do not invent acceptance.

## Required backend integration

1. Supply the actual order creation/availability and admin accept/decline/suggest-time handlers, relevant schema/types, and existing event/revision mechanisms, with secrets removed. Browser confirmation-email requests are not authoritative decision hooks.
2. Identify the post-commit authoritative decision boundary and capture an immutable pre-decision snapshot. Use a stable opaque key per decision revision, scoped to site/environment. Include requestedMinute, decidedMinute, decisionAt and the actual outcome. Never include the candidate twice.
3. Feed an independent durable shadow queue or existing durable decision-event feed. **Do not add writes to production Supabase.** Queue/record storage belongs to the separate shadow subsystem. A post-commit best-effort enqueue alone cannot guarantee coverage: use replayable authoritative events/reconciliation and alert on missing revisions. Do not make booking success conditional on shadow enqueue or processing.
4. Run `createShadowWorker` in a separate background process, with a leased queue implementation. Queue methods `claim`, `ack`, `retry` must have I/O deadlines, exponential backoff, bounded attempts and quarantine/dead-letter handling. Permanent invalid events need quarantine rather than endless hot retries. Queue leases must exceed the processing budget and be reclaimable after worker death.
5. Inject `createReplayAssessment()` into `createLiveShadowObserver`, and store.persist from `createRecordStore('/dedicated/volume/master-wok-records')`. Both worker and observer remain disabled unless enabled explicitly. There is no automatic environment-variable enablement.
6. Use `TZ=Europe/London` before Node starts. The adapter returns UNVERIFIED on the wrong timezone. Pin this package/build checksum in deployment metadata; records currently use the static model label `master-wok-shadow-v1`, so isolate records per deployed build until a backend build identifier is added.
7. Use a persistent POSIX volume with fsync and hard-link support, restricted ownership and backup. Ephemeral Railway/container disk does not provide persistence across replacement. This implementation is a single-volume staging baseline, not a distributed database. Do not point it at customer/order directories. Agree retention and review access before enabling; snapshots in the separate queue must be restricted, minimal and expire after processing.

## Monitoring

Schema v2 records contain eventKey, serviceDate, authoritativeOutcome, prediction, reasonCode, modelVersion, requestedMinute, decidedMinute, decisionAt, `authoritative:false` and `evidenceBasis:'HYPOTHETICAL_PLAN'`. An opaque key format cannot itself prove that the caller has excluded PII. No observer-generated timestamp is used as an idempotency input.

The summary groups by service date, model prediction and actual booking outcome. GREEN+DECLINED and AMBER+ACCEPTED are comparison cells, not proof either system was wrong. UNVERIFIED must remain separate from AMBER. The decided/requested delta is available per record. No actual food-ready, cooking-start or customer wait measurements are available.

Backend monitoring must additionally track eligible decisions, enqueued events, durable observations, queue age, retries, failed/dead-letter events, record-store failures and build identity. Reconcile distinct event keys against authoritative revision counts: successful stored records alone cannot reveal missing events. Suggested initial alerts: any storage failure/conflict/corruption; any eligible decision without a record after five minutes; oldest queued event over two minutes; sustained UNVERIFIED increases. These thresholds are staging starting points, not measured service targets.

## Deployment sequence (approval required before production deployment or enablement)

1. Review this package and the missing backend files; implement the real decision mapping, leased queue and coverage reconciliation in a test environment.
2. Replay a redacted busy trading day and investigate all AMBER/UNVERIFIED observations with the stated historical limits.
3. Stage disabled first; confirm zero shadow reads/writes/calls. Enable on synthetic decisions; exercise redelivery, process restart, storage outage, engine timeout, queue outage and candidate revisions. Prove booking responses/outcomes are unchanged and no production Supabase writes occur.
4. Review the concrete backend patch, queue/volume setup, access/retention controls and observed coverage. Obtain explicit approval for production deployment. Deploy disabled; enable only when separately approved or explicitly covered by that approval.
5. Monitor coverage and comparison cells over busy service periods. Roll back by disabling the worker/observer; preserve existing records and leave booking logic untouched. No customer-facing model control is included.

## Local commands (reference; no user diagnostics required)

```sh
TZ=Europe/London node --test master-wok/*.test.js
TZ=Europe/London node master-wok/master-wok-cli.js replay 2026-10-14 master-wok/fixtures/historical-synthetic.json
TZ=Europe/London node master-wok/master-wok-cli.js observe-fixture master-wok/fixtures/accepted-event.json /absolute/local-shadow-volume
node master-wok/master-wok-cli.js summary /absolute/local-shadow-volume
```

The CLI observation command explicitly opts in for offline fixtures. It has no network/database code. Never point it at a production data directory. Observer deadlines cannot stop synchronous callback CPU work or guarantee cancellation of arbitrary I/O; the VM limits engine search, and queue/storage callbacks must honor their own deadlines. A timed-out persistence callback may complete later: retry with the identical event key/record is safe. Worker processing must remain outside checkout.
