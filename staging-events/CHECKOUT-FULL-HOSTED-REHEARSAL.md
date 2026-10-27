# Complete checkout hosted staging rehearsal — 27 October 2026

The full-payload candidate passed a bounded rehearsal on PostgreSQL 17.11 in **hvrqgufqjslvgiohgkvu**, using the existing private Railway test service, its existing reader/writer logins and existing audit volume. Production was not accessed or changed. The trial is disabled again and temporary permissions are revoked.

Runtime commit: `d75e5fd548ede8fcd0363fcd67e109bd5369fedd`. The expired 26 October trial never ran: it remained disabled, had zero receipts and its permissions were revoked after the approval interruption. Fresh 28 October fixtures use different identities and a new durable budget directory; earlier audit rows are retained.

## Observed outcomes

| Case | Hosted witness | Result |
|---|---|---|
| Same request | Two real writer connections; waiter blocked by holder; uncommitted export invisible | RECORDED then ALREADY_RECORDED; one event |
| Same quote | Two real writer connections; same lock witness | FULL_CHECKOUT_QUOTE_USED for competing order; one event |
| Holder rollback | Waiter blocked until holder rollback | Waiter RECORDED; one order/event |
| Lock timeout | SQLSTATE 55P03 under a held stream lock | Exact retry RECORDED then ALREADY_RECORDED; one event |
| Loopback HTTP | Actual Node FullSubmissionAttempt, seven requests, fixed SQL through real writer role | Unauthorized/extra/duplicate fields refused; post-commit application failure retried; collection and delivery each recorded once |
| Saved event journal | Actual hosted export, intake, engine processing, snapshot restore | Two reservation events; zero actual decisions; restored journal IDLE |

The reader witnessed the live lock contention using pg_blocking_pids; the writer role was checked as non-superuser and non-bypass-RLS, without quote mutation, receipt editing, private snapshot reading or route switching rights. The normal role could insert the full private snapshots through the candidate's SECURITY INVOKER transaction. Total durable trial use: one start, 13 writes, 13 reads, three lock probes, within fixed limits and a nine-minute deadline.

An independent administrator equality query matched **all six complete private order payloads and all twelve ordered item payloads** against the expected source-shape fixtures. There were exactly six route receipts, six orders, twelve items, six reservations and six engine events; no duplicate records. This covers all three inspected checkout page shapes. Financial/loyalty/delivery/preference fields and optional notes were retained without repricing or normalization. Minimal engine exports excluded the tested private values and raw browser request UUIDs.

A separate hosted administrator BEGIN/ROLLBACK check supplied an invalid second basket line and verified that the earlier receipt/order/first item and all booking/reservation/event writes were absent after the failed function call. The management connection cannot SET ROLE to the runtime login; no extra membership was granted. Actual runtime-role commit/rollback/concurrency were exercised by the Railway connections above. Outbox/late receipt injection remains local test evidence, not a claim of hosted trigger injection.

## Deployment and shutdown evidence

- Refreshed disabled deployment `4d819894-355c-4be6-b97b-44aa661fe42e`: SUCCESS, DISABLED, sourceRequests=0.
- Enabled trial deployment `beb326b6-90c9-4bdb-9d78-1950d18bb3cc`: SUCCESS, OBSERVED, scope SYNTHETIC_FULL_CHECKOUT, notifications=0, productionWrites=0, verified=false.
- Cleanup deployment `b298f742-5020-4f85-ab08-2e5bcf8d099c`: SUCCESS, DISABLED, sourceRequests=0.
- Independent database read-back: **zero enabled streams globally, zero runtime sessions**, no temporary route/quote/receipt/order/item access and no full submission/validation execution. Existing create_booking rights remain unchanged.
- No staged Railway changes. No public domains, TCP proxies, additional services, volume expansion or tracing were added. Existing resource usage was reused; incremental billing was not measured.
- Security advisors retain the same two pre-existing INFO notices for unrelated private delivery-test tables with RLS and no policies; no new finding. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The existing volume retains the private run evidence, packets and journal snapshots in `/data/full-checkout-trial-28-oct-v1`. The database retains synthetic audit records on disabled streams; these are not live reservations. Do not delete the evidence or rerun the spent one-start budget. The public captured fixture contains only the synthetic engine export.

## Verification and remaining scope

14 Python tests and 26 Node entries pass in **each** of Europe/London and UTC. This includes independent replay of the actual hosted capture, restricted-role tests, complete snapshots, privacy, retries and rollback. Exact results and source/evidence links are in checkout-full-hosted-results-27-oct.json, checkout-full-hosted-verification.sql and the hosted capture fixture.

This establishes the complete-payload **synthetic staging transaction**, not production checkout authorization or full event-history coverage. No public endpoint or live scheduling behaviour was connected. Trusted quote issuance, customer/address ownership, catalog/pricing authority, ASAP target resolution, browser reload idempotency and remaining lifecycle writer coverage still need review. order-confirm source access remains unresolved. The private snapshots are JSON, not a typed production schema replica. HTTP failure was injected after commit before application success, not physical packet loss. Concurrency used READ COMMITTED. Full connected-day/multi-hop routing and continuous observer integration remain outstanding.

Next: resolve the production authorization and lifecycle-capture contracts around the tested transaction, then review the smallest producer integration. Keep the production observer read-only and preserve uncertainty until those dependencies are satisfied.
