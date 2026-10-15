# Master Wok experimental shadow handover — 14 October 2026

## Changes in this package

- `master-wok-shadow.js`: added `replayReservationsV1(serviceDate, reservations)` for deterministic, read-only, chronological, commitment-aware assessments. Advance bookings use the service-day kitchen start; jobs already started are protected; future jobs may be rearranged. Separate conservative and raw hypothetical timelines are maintained. A historical AMBER order remains in the historical accepted set; if the engine cannot allocate it, later decisions are explicitly UNVERIFIED rather than inventing commitments.
- `master-wok-shadow.js`: added `replayHistoricalCapacityV1(serviceDate)`, which calls the existing validated read-only historical loader and then the replay. This is **experimental** and returns `verified:false`.
- `master-wok-shadow.js`: corrected YYYY-MM-DD parsing to construct a local service-day midnight and reject invalid calendar dates.
- `master-wok-replay.test.js`: new synthetic regression checks for advance orders, chronological order, valid hypothetical plans, no fabricated plans after failure, and invalid post-service placement.

## Tests run

`node --test master-wok-regression.test.js master-wok-shadow.test.js master-wok-replay.test.js` — PASS (three test files). Also run with `TZ=Europe/London` — PASS.

## What is **not** implemented or deployed

- No production changes, no GitHub push, no Supabase writes.
- The current `index.html` still sets `MASTER_WOK_SHADOW_ENABLED = false`. Do not turn this on: it fetches the entire historical order dataset on a checkout attempt, logs only to a browser console, and calls a date-unaware assessment function. This is neither scalable nor reliable central monitoring.
- No persistent server-side observer exists in the supplied files. To deploy full live shadow safely, inspect the **actual server-side order confirmation/availability flow** and add a post-decision, failure-isolated observer with idempotent durable records. Never let shadow errors block checkout. Consider privacy, access controls, retention and appropriate data minimisation.
- The replay is a comparison with historically accepted orders, not a verified reconstruction of Rung's cooking. If a hypothetical timeline becomes infeasible, subsequent results become UNVERIFIED. Raw batch minutes are not a complete active/passive cooking simulation.
- Historical data loader still performs a paginated whole-order read and separate count checks. It is appropriate for controlled diagnostics, not per-checkout invocation.

## Suggested safe next step

Supply the backend files that handle order confirmation and the availability endpoint, plus any relevant schema/migrations (redact secrets). Design durable shadow monitoring against **confirmed order events** and compare predictions to accepted/confirmed times. Gate behind a server-side feature flag, keep zero customer impact, and stage-test before separately authorising production deployment.

## Local manual verification (after applying files to a local test branch)

In Chrome DevTools on local RTK site, with Supabase available:

`await window.MasterWokShadowV1.replayHistoricalCapacityV1('2026-09-18')`

This reads historical data only and returns `UNVERIFIED` with diagnostic observations; it does not submit or modify orders. It has **not** been run here against real Supabase because the upload contains no live database access.

## Live shadow observation boundary — second handover

- `master-wok-live-shadow.js`: opt-in CommonJS server-side observation component. Takes an injected `assess` function and injected `persist` function. Called only after an authoritative order decision; no network access or database code is included. Fail-open for invalid inputs, assessment exceptions and persistence failures. Persists only allowlisted metadata (opaque event key, service date, authoritative outcome, model prediction, reason code, version, `authoritative:false`). Does not log customer details, baskets, or exception messages.
- `master-wok-live-shadow.test.js`: seven Node tests for disabled operation, data minimisation, assessment failure, persistence failure, invalid event, invalid prediction and calendar validation.
- Four test files pass with `node --test master-wok-regression.test.js master-wok-shadow.test.js master-wok-replay.test.js master-wok-live-shadow.test.js`.

### Backend integration contract (not yet implemented)

1. Locate the actual authoritative acceptance/decline/suggest-time decision point in the backend. Do not infer it from the browser's `send-order-confirmation` request.
2. Capture a consistent pre-decision snapshot, the requested service date/time and a stable opaque event/revision key. Do not feed the observer a post-decision snapshot containing the proposed order twice.
3. Inject an `assess` adapter that invokes Master Wok using that snapshot. Return `UNVERIFIED` when completeness or commitments are uncertain. Never treat an AMBER or UNVERIFIED result as a refusal.
4. Inject a durable `persist` implementation with a unique constraint on eventKey, idempotent retry semantics, restricted access and an agreed retention period. Keep the observer's log data minimal. A fire-and-forget in-process call is not a durability guarantee; an outbox/queue may be required for reliable delivery.
5. Gate with a server-side feature flag initially off; stage-test with real backend shapes and ensure observer errors do not affect checkout latency or booking outcomes.
6. Only deploy or enable after explicit approval. Current supplied files do not include backend sources, schema or migration scripts; no real-time observations have been stored.
