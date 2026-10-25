Latest result: [CUTOVER-RESPONSE-HTTP-REVIEW.md](CUTOVER-RESPONSE-HTTP-REVIEW.md). The guarded route has passed with the restricted hosted login; the earlier prototype receipt weakness below is superseded by admin-owned attestations. Live coverage and automatic router handover remain incomplete.

# Booking coverage and observer handover — 25 October 2026

Production is unchanged. Overall readiness for complete booking-decision comparison remains false. Successful concurrency/recovery checks do not close the live writer-coverage gate.

## Current coverage review

| Path | Evidence | Remaining requirement |
| --- | --- | --- |
| Main checkout | index.html at website commit 55938bc73cd762be614a300ef54bacaedda5f6b0; order upsert and item insert are separate calls | Capture a complete basket only after its actual persistence boundary; do not call an order INSERT a complete booking |
| Alternate checkout code | Another order/item insert path remains in the source; reachability unproven | Establish reachability or instrument it before claiming all writers |
| Admin accept/suggest/decline/complete | Proxy targets hyper-worker, confirmed by owner dashboard; credential changes did not add lifecycle event capture | Adapt all active lifecycle actions to the shared atomic command/reservation/event contract |
| Admin details status selector | Source attaches a change handler to updateOrderStatus, which updates orders directly | Cover this writer or explicitly retire it through a separately reviewed product change |
| Railway customer time responses | Owner-supplied backend and deployed credential patch preserve separate accept/decline mutations | Revision-bound, idempotent transactional response integration is still needed; no test request sent to real customer links |
| Legacy order-confirm | Source retrieval again returns UNAVAILABLE; owner still sees a blank Code tab | Do not overwrite, remove or assume unused. Recover source or formally bound legacy coverage before a completeness claim |
| review-order Edge function | A distinct mutation contract exists; current use unproven | Establish active callers or explicitly limit claimed coverage |
| Direct console/external edits and basket edits | No approved production event producer covering them | Treat as unknown/amendment evidence; do not infer a customer decision from a changed row |
| Browser capacity rejection before persistence | No corresponding booking row necessarily exists | Full engine parity requires evaluation input/outcome capture, beyond accepted-booking lifecycle history |

The private order-backend repository still returns 404 through this GitHub connection. The owner-supplied source remains usable review evidence; the access gap is not an instruction to disclose credentials. Production order-confirm still cannot be retrieved. Nothing in this review grants additional permissions or changes live reservations, source credentials, checkout, notifications or capacity decisions.

## Handover defect and isolated compatibility candidate

The staging HMAC response token includes its origin stream. Simply configuring the existing response adapter with a destination stream refuses old signed links. A new characterization test reproduces that refusal. Therefore the earlier four concurrency cases do not by themselves prove a complete application/router handover.

Unwired event_cutover_response_staging.py validates the original signed stream/order/proposal claims with the existing HMAC adapter, then binds a fixed seven-parameter query. Origin/destination/cutover IDs are trusted server arguments and cannot be supplied by the response body. Default-off returns before route, key or transport handling. No real database transport, HTTP route, production import, environment flag or grant is installed by this candidate.

The matching private SQL candidate apply_cutover_response locks source and destination in the seeder's UUID order. It requires a retired source, enabled destination, matching synthetic scope/service date, the exact committed seed receipt and matching first baseline event. It resolves the signed alias in the destination and delegates to existing apply_booking, preserving proposal revision guards and copied command receipts. Acceptance changes commitment without a second reservation; rejection releases it; exact retries retain their original outcome. Missing/mismatched receipts, reactivated sources, retired destinations and non-response actions fail before a booking update.

The stored-receipt check assumes cooperating fixed-query writers. The current staging writer has direct INSERT grants on event/command tables, so this receipt is not an administrative attestation against a compromised writer. A production router needs separately protected cutover receipts; this candidate does not establish that permission boundary.

This is intentionally a single-hop, same-day compatibility candidate. It does not automatically select the current writer stream, follow chains, or route connected service-date transfers. Those require an authoritative command-router design and consistent cutover mapping; arbitrary client redirects are not a substitute. Existing production customer tokens use a different legacy contract and are not silently converted to staging tokens.

## Verification completed

- Five Python response tests cover default-off, the original stream-switch refusal, stable request/revision binding, unrelated tokens/body overrides and transaction failure propagation.
- Two observer tests use an actual hosted baseline and real Node/journal intake. Old source identity cannot be relabelled or reused; a new stream gets a separate journal, survives ACK interruption/restart, refuses an old-source envelope and records no reconstructed historical decisions.
- All seven Python tests pass in both Europe/London and UTC.
- Ten Node test entries pass in each timezone against pinned PGlite 0.3.14. The actual Python signed-response adapter also generates a command executed by the local PostgreSQL engine. Real SQL checks cover accept/reject/retries, copied pre-cutover acceptance receipts, stale revisions, invalid receipts, retired/reactivated streams and invoker-only/no-public-execution ACLs.
- A hosted PostgreSQL 17.11 transaction installed the candidate temporarily, created synthetic fixtures, seeded a baseline and checked acceptance/retry/one reservation, stale refusal and missing-receipt refusal. ROLLBACK removed the function and fixtures. Independent post-rollback result: candidate absent, enabled_streams=0. This was not a runtime-login, HTTP or concurrent-wrapper test.

The observer test validates explicit reconfiguration to a new identity; it does not prove an automated atomic writer-and-observer switch or fresh runtime health. No live scheduling behavior changed and no rehearsal service was redeployed in this work. The previously deployed cutover witness remains disabled with restart NEVER.

## Smallest safe next implementation

1. Add a fixed-query restricted staging transport and optional private response-route wiring for this candidate; grant only the reviewed function to the existing staging writer when its hosted test is approved. Exercise it with actual signed HTTP requests and the restricted role, then disable it.
2. Define one authoritative current-route mapping and atomic cutover receipt for command routing. Couple observer identity changes to acknowledged baselines, retain the previous journal, and require a fresh read/recovery before health can become green. Cover connected-day/multiple-hop cases before enabling them.
3. Prepare the exact live writer diff only after the alternate checkout and legacy response paths are resolved. Shared transaction: complete order/basket mutation, reservation change, immutable event and request receipt commit together. Notifications/replay remain outside that transaction. A separate row-change audit may honestly cover manual changes, but cannot invent business decisions.
4. Present production integration, capture permissions and observed discrepancies for review. Keep current read-only polling labelled CURRENT_SAVED_STATE/POLLED_STATE_NOT_DECISION_HISTORY until prospective event coverage is actually established. No production migration or activation is authorized by these staging tests.
