# Hosted checkout submission rehearsal — 25 October 2026

The bounded restricted-account rehearsal passed. Production is unchanged. This establishes transaction, retry and HTTP behaviour for the supported synthetic checkout shape, not production integration readiness.

Runtime commit: `2b9e15838b34694bcf897cdcb1d6e5bc3268fe65`.

## Actual hosted evidence

| Case | Observed result |
| --- | --- |
| Simultaneous same request | Second writer was witnessed blocked by the first writer's uncommitted submission. Reader saw no uncommitted event/basket. After commit the waiter returned ALREADY_RECORDED; one event remained. |
| Simultaneous same quote, different request/order | Waiter was witnessed blocked, then refused CHECKOUT_QUOTE_USED after first commit. No second booking or event. |
| First submission rolls back | Waiter was witnessed blocked and reader still saw no export. After rollback the waiter recorded the complete submission; no first-attempt receipt remained. |
| Lock timeout | PostgreSQL returned 55P03; same-request retries returned RECORDED then ALREADY_RECORDED with one event. |
| Real Node adapter through loopback HTTP | Seven HTTP calls covered missing authorization, extra route override, duplicate JSON keys, collection submission with injected post-commit failure and exact retry, and delivery submission/retry. |
| Replay and restore | Two HTTP-produced reservation events were replayed and restored from a local snapshot. They generated zero actual-decision comparisons; creation/reservation is not an admission or actual cooking activity. |

The HTTP injection raises an error after the database transport has committed but before a success response is returned. The adapter receives HTTP 409 and retries the same request successfully as ALREADY_RECORDED. This is an application-level committed-but-unsuccessful-response witness, not a physical packet-loss experiment.

An independent management SELECT read back six synthetic orders, twelve item rows, six reservations, six submission receipts and six events. Each order had its full two-line basket. The rollback case retained only its second request ID. One delivery event retained `deliveryReadyEstimate:null`; no route duration, food-ready activity or driver movement was invented. Financial/customer-alias fields were retained in the private synthetic checkout snapshot and excluded from the engine event allowlist.

Enabled deployment `3d49ddd3-b6a7-47dd-871c-b3973a78135b` completed SUCCESS and logged OBSERVED. Durable counters: one start, 13/20 write attempts, 14/16 reads and 3/40 probes. The runner pins project/environment/service IDs, requires other trial flags false, refuses production DSNs, enforces a maximum ten-minute deadline and cannot restart its one-shot budget. Initial deployment `082f2a65-f6a7-4dd7-a260-a12c50d85695` was disabled and made zero source requests.

The existing staging service `012e5ef6-6225-4ab3-95f5-894583db7e83` and its 500 MB /data volume were reused. The endpoint binds loopback only; no public domain, new service, bucket or provider resource was created. All notifications were zero.

## Permissions, scope and cleanup

Private staging migration `master_wok_private_checkout_submission_rehearsal` installed the candidate and temporary writer grants. The functions remain SECURITY INVOKER. The fixed-query transport verified the actual writer is neither superuser nor RLS bypass, cannot create/edit/delete quotes, cannot update/delete receipts, and cannot mutate/switch the route. Existing private reader permissions were reused; no reader grant was added. This cooperating fixed-query process still relies on the existing invoker/table permissions; it is not a production authorization design for untrusted browsers or compromised database writers.

The optional `/staging/submit-checkout` callback is absent by default. Only this isolated runner installs it. The new path rejects duplicate keys and binds the route on the server; an operator token is additional staging authorization, not customer identity. Body intake is bounded at 100512 bytes for this path, retaining the earlier 8192-byte limit for other paths. Transport payloads remain capped at 100000 bytes. No production module imports the runner or transport.

The trial flag is false and deadline zero. Migration `master_wok_checkout_rehearsal_disable_and_revoke` disabled all five test streams and revoked the new route/quote/receipt/submit permissions. Independent check: zero enabled staging streams, zero active runtime sessions, and no remaining route SELECT, quote access, receipt access or submit EXECUTE for the writer. Pre-existing create/collection and delivery function permissions were preserved. Private functions, fixtures and audit rows remain for review; historical test reservations are retained in retired streams and have no live capacity authority.

Cleanup deployment `3804e82b-e5a8-4539-95ac-c63544401ac8` completed SUCCESS and logged DISABLED with zero source requests. No staged Railway changes remain. Before/after security-advisor results contain the same two informational no-policy notices on unrelated private delivery-test tables; this rehearsal introduced no new notice.

## Validation and remaining work

Final local checks: 21 Python tests and 18 Node test entries passed in each of Europe/London and UTC. This includes actual Node-adapter/Python-HTTP integration with a simulated database, SQL failure/rollback tests, default-off/scope/privilege/budget checks, and two independent hosted-export replay/receipt tests. The separate hosted run above supplies the actual restricted PostgreSQL and concurrent-session evidence.

Evidence: `checkout-submission-runtime-results.json`, `fixtures/checkout-submission-runtime-hosted-capture.json`, `checkout-submission-trial-fixtures.sql`, `checkout-submission-runtime-role.sql` and `checkout-submission-trial-cleanup.sql`. Source files and synthetic evidence are committed on the review branch; the service remains pinned to the runtime commit so later documentation commits do not deploy.

Next: map the complete current production payload and authorization boundary without introducing unreviewed pricing or availability rules; adapt every retained writer or explicitly retire it. Real addresses/notes/customer IDs, loyalty/discount details, a trusted quote issuer and browser-reload key recovery are not supplied by this synthetic shape. Source for retained `order-confirm` remains unresolved. The normal READ COMMITTED transaction behaviour was tested; other isolation modes and new cross-day/multi-hop wrappers are not established by this rehearsal.

Only after reviewing that concrete integration diff and approving production capture writes should a prospective production baseline and bounded read-only observer be enabled. Master Wok remains advisory; production scheduling/checkout decisions, customer notifications and production Supabase were not modified here.
