# Guarded cutover response route — hosted staging passed, 25 October 2026

The guarded private response integration is now tested with real loopback HTTP and the existing restricted PostgreSQL login. This closes that specific staging step, not live writer coverage or automatic current-route selection. Production remains unchanged.

## Implemented and installed only in private staging

The optional /staging/cutover-proposal-response route is absent unless a trusted callback is explicitly installed. It requires the private operator credential before parsing; the callback additionally validates the original stream/order/proposal HMAC. Duplicate JSON fields and client route overrides are refused. The default-off CutoverResponseTransport accepts one fixed seven-parameter SQL statement, pins staging origin/TLS/role, sanitizes raw errors, and refuses an overprivileged writer before submitting a response.

The earlier prototype's ordinary seed-receipt caveat is resolved for this candidate: a separate RLS-protected cutover_response_routes table records administrative authorisation. The existing writer was temporarily granted SELECT and guarded function execution, but no INSERT/UPDATE/DELETE on that table and no execution on authorize_cutover_response_route. The admin function validates a committed baseline, exact seed receipt, retired source, enabled destination and matching scope/service date before writing an immutable route. Runtime responses recheck that state and receipt under the existing sorted stream locks. Revoking new runtime grants after the trial restored the restrictive boundary.

Migration master_wok_private_cutover_response_route is installed in staging hvrqgufqjslvgiohgkvu only. It adds one private table and two SECURITY INVOKER functions; PUBLIC, anon, authenticated and service_role have no access to them. No production table, credential, migration or endpoint changed. The two existing INFO security-advisor notices on inaccessible master_wok_delivery_test tables remain unchanged; no new finding was reported. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .

## Actual bounded hosted sequence

Reviewed code commit 1793c17a0eca9378de3bb26f92ffc4d3137c90be deployed disabled as 2e562866-7845-4331-b79d-bf87eb1c7b94 and emitted DISABLED/sourceRequests=0. Fresh fixture preparation first passed under rollback, then committed a fixed synthetic same-day collection pair for 26 October, both disabled. The source had two events; the destination had one baseline and its administrator-owned route receipt.

Only the destination was enabled for deployment 2e55ffc2-b2ed-47cb-b885-9159ec903337. It emitted OBSERVED at 06:53:43 UTC. Ten loopback HTTP requests covered missing operator auth, a client route override, an unrelated-origin token, old-link acceptance/retry, a new proposal, stale rejection, a retry of the original acceptance receipt, and a new signed rejection/retry. The writer made seven bounded attempts, the reader made one export, and the start-once budget was consumed once. Ephemeral signing/operator/health keys were never logged or persisted. There were no external notification, route-provider or object-storage calls.

Independent SQL readback confirmed source event_count=2, destination event_count=4, final status customer_declined_time and zero destination reservations. Destination events are baseline, acceptance of offer-a, offer-b, rejection of offer-b. Repeated responses created no extra event. The actual export is fixtures/cutover-response-http-hosted-capture.json. The persistent worker produced one hypothetical comparison, then verified snapshot/restore and an idle recovered inbox. Baseline rows never became invented historical decisions or actual cooking activity.

## Tests and cleanup

Thirteen focused Python tests passed, including fixed SQL binding, privilege refusal, exact staging scope, deadline/start-once budgets, default absence of the new route, duplicate JSON refusal and the unchanged earlier signed HTTP flow. Twelve local PostgreSQL Node test entries passed in each of Europe/London and UTC; these include the Python signed adapter feeding the real SQL candidate, immutable admin-authorisation requirements and runtime ACLs. A separate regression of the actual hosted capture passes in each timezone, including persistent duplicate intake and restart. No tests skipped.

Cleanup deployment 19647d01-743c-4e6f-89a4-3ee24ce6eb2e reached SUCCESS and emitted DISABLED/sourceRequests=0. The new flag is false and deadline zero. All staging streams are disabled and active staging reservations are zero. Temporary SELECT on the route table and guarded-response EXECUTE were revoked from the writer, with independent privilege readback confirming both are absent. The new table/functions and synthetic evidence remain for audit; admin owns the attestation and the worker cannot use it until separately reauthorised. Persistent attempt markers and previous histories were not reset. The existing service remains a disabled one-shot test service with restart NEVER and its original volume; no service/domain/volume/bucket was created.

## What this does not claim

The test uses an explicit trusted route and one same-day collection cutover. It does not implement an authoritative changing current-route selector, multi-hop resolution, coordinated multi-date routing, complete delivery lifecycle coverage, or production legacy-token conversion. The successful direct-session concurrency witness is recorded separately; this HTTP run does not add a concurrent-wrapper witness. Production checkout/admin direct writes and the unreadable order-confirm source remain the writer-coverage gaps recorded in BOOKING-COVERAGE-AND-HANDOVER-REVIEW.md. No production activation follows from this staging result.

Next implementation is an authoritative current-route mapping coupled to cutover and observer baseline acknowledgement, tested with concurrent/retried requests. Only then can the exact reviewed live writer diff be prepared; activation requires resolving the existing source-coverage limits and production-write constraints explicitly.
