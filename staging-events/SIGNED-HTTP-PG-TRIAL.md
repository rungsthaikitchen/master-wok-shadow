# Private signed-response HTTP / PostgreSQL acceptance trial

Uses the existing staging service and private synthetic schema only. No production mutation, new resource, public domain, provider call or notification. Default-off flag MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED must be explicitly true; all prior runtime/trial/soak/cloud flags must be false. Existing exact Railway staging scope, pinned database users and verified TLS checks remain mandatory. The fixed deployment deadline must be no more than ten minutes ahead. This one-shot test uses a fresh stream/directory and never resets an older allowance.

Stream 72c0464b-9fa7-4947-82d2-0ac4dbd42438 and directory /data/customer-http-pg-72c0464b. One controlled synthetic collection basket. Persistent allowance: eight writer calls and one export, consumed before each attempt. Failures consume allowance. Restart policy NEVER. HTTP listens on loopback only; existing operator Bearer authentication is still required. This is an operator-controlled staging rehearsal, not a publicly authorized customer endpoint.

The optional /staging/proposal-response route is absent unless an explicit signing key is supplied to serve_api. The trial generates a fresh in-memory key, signs fixed proposal identities, and discards it at exit. No signing key, token or customer data is printed or committed. Existing staging routes retain their default behaviour without that optional argument.

Sequence: offer 1, offer 2, stale acceptance of 1 (409), accept 2 (RECORDED), repeat accept 2 (ALREADY_RECORDED), conflicting reject 2 (409), offer 3, reject 3 (RECORDED). Then one fixed read-only export goes through durable intake and real replay. Expected committed history has five events: three offers, one acceptance, one rejection; three comparisons; final needs_time status and zero reservations. HTTP refusal alone is not proof of the specific PostgreSQL reason, so a separate DB readback must confirm the exact event history and final state.

No automatic cloud upload or prolonged monitoring occurs. On completion or failure disable the synthetic stream, set the trial flag false, restore the default-off runtime start command, and verify DISABLED with zero source requests. Preserve all source events and spent budgets.

Local validation: 43 event-related Python tests passed in 11.956 seconds. Three new tests cover real loopback HTTP through the local transaction/replay validator, absent-by-default route, missing operator authentication, GET refusal and persistent failed-attempt caps. An initial local HTTP test shared a SQLite connection across threads; the fixture was corrected to open a connection per request, matching the existing source pattern. No application transaction change was needed. Actual PostgreSQL deployment evidence follows only after observed.

## Deployed evidence — 20 October 2026

Deployment 5bd35f61-d527-4519-98c7-c3fe9381f09e, pinned 571dcdacc9f4723b1a6ba34166a743d8f0a91898, reached SUCCESS. At 06:33:57 UTC it logged SIGNED_HTTP_SEQUENCE_FINISHED / httpCalls=8. At 06:34:00 UTC it logged OBSERVED / QUEUED / RECORDED / observations=3 / attempts={reader:1,writer:8}. All outputs retain verified:false.

A separate read-only PostgreSQL query confirmed five events in sequence: offer 1; offer 2; ACCEPTED response to signed-offer-2; offer 3; REJECTED response to signed-offer-3. The order status is needs_time and reservation count is zero. Thus stale/conflicting responses and the retry did not add events; acceptance followed by the third offer and rejection followed the intended lifecycle. The synthetic stream was then disabled, retaining all five events. No credentials, tokens, live orders or production database objects were changed.

This proves the operator-authenticated loopback HTTP -> narrow TLS PostgreSQL handler -> read-only export -> durable journal -> real replay path for this bounded synthetic sequence. It does not exercise an actual customer browser, production token issuer, SMS/email links, parallel HTTP clients or production order schema. The existing staging handler concurrency tests remain separate evidence. Future production integration still requires the reviewed source mutation/outbox transaction, complete creation/basket boundary and migration of all active callers.

Cleanup deployment 0bfa4f07-6ef0-4f1d-91c6-50f2cedd2744 reached SUCCESS and logged DISABLED / sourceRequests=0 at 06:35:22 UTC. The signed trial flag is false, default-off runtime command restored and Railway has no pending staged changes. All evidence and spent budgets are retained.
