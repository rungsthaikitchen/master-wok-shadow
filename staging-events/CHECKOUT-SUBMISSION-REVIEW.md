# Atomic checkout submission candidate — 25 October 2026

Update: the [restricted hosted concurrency and HTTP rehearsal](CHECKOUT-SUBMISSION-HOSTED-REHEARSAL.md) has now passed. The candidate was installed privately in staging for the bounded run, then its streams were disabled and temporary grants revoked. The original candidate-stage record below is historical; the production mapping and authorization limitations remain.

Default-off, isolated synthetic staging candidate. No production migration, checkout edit, runtime import, grant or deployment. This extends the previously tested atomic kitchen-booking store with a complete **supported checkout snapshot** and a route-wide retry receipt. It is not a drop-in replacement for the production payload.

## Transaction and retry boundary

`submit_checkout` takes the same shared route lock and stream lock as routed commands. It validates a matching, unexpired administrator-provisioned staging quote, then inserts one checkout receipt/snapshot and delegates complete basket persistence plus reservation/event capture to the existing booking transaction. An exception at any point rolls all of these changes back together. There is no remote call, notification or engine execution inside the transaction.

The receipt is keyed by route and request ID, with unique order/quote constraints. Matching retries return the original result before testing quote expiry; changed payloads with the same request ID fail. A second request cannot redeem the same quote again. The receipt stays at the route level across cutover, so a lost response retried after handover does not create another destination event or overwrite a later offer. A disabled current route still refuses submission and retry.

`SubmissionAttempt` is an unwired default-off adapter with one fixed query. The caller supplies request/order IDs once and retains the attempt. It freezes the basket snapshot and reuses the same IDs after failure. It reports success only from a committed SQL receipt. It performs no fetch, pricing, availability calculation or notification and refuses production project configuration. Persisting/recovering an attempt across a browser reload is not yet implemented; callers must not regenerate a key just because a response was lost.

## Supported shape and privacy

The staging snapshot includes synthetic customer/order aliases, collection/delivery type, requested timestamp, payment/communication preferences, integer-pence totals, ordered lines, quantities, unit prices, modifier IDs/deltas and spice. Subtotal equals quantity times final unit price; modifier deltas are retained as breakdown and are not charged a second time. Discount/fee/total arithmetic is checked. All supported lines are required in the single request; there is no partial-basket submission endpoint.

The engine event receives only the existing allowlist of item IDs, quantities and modifier IDs, order alias/type and target. Customer aliases, prices, payment preferences and spice do not leak into the event export. Delivery without supported route evidence retains `deliveryReadyEstimate:null`; the request is not invented cooking or driver activity, nor an actual admission decision. No kitchen calculation changed.

Quotes do not reserve capacity. Quote expiry only prevents a new submission against an unused quote; it neither expires nor releases an existing booking reservation. The quote table has no runtime/public grants, and this prototype supplies no quote-issuing endpoint. It therefore cannot treat a browser's financial fields as trusted just because arithmetic matches.

Real names/addresses/notes, customer UUID mapping, menu display names/images, discounts/loyalty detail and all other current production fields are intentionally not accepted by this supported synthetic contract. A production adapter must preserve or explicitly map each required field rather than silently dropping it. Server-side quote/pricing authority is unimplemented. Any change from current pricing validation is a separate reviewed business change; this candidate does not authorize one. Capture-only integration must preserve current customer-visible pricing, availability and notification behaviour.

## Validation

Seventeen focused Node test entries passed in Europe/London and UTC. Together with the adjacent route/cutover fixture tests, 29 entries passed per timezone. These exercise actual pinned PGlite SQL and the fixed-query adapter, including:

- Complete checkout snapshot and complete engine basket committed once.
- Invalid second line, outbox failure and late booking-receipt failure leave no order, items, checkout receipt, event or reservation.
- Quote mismatch, wrong totals, empty basket, fractional money and unexpected private fields fail before success.
- Quote reuse and conflicting request reuse are refused.
- Exact retry survives quote expiry, later proposal and route cutover without duplicate events or capacity.
- A simulated lost response occurs **after actual SQL commit**, then the same adapter request returns `ALREADY_RECORDED`.
- Delivery does not invent a food-ready estimate; default-off and public/runtime execution denial remain intact.

`checkout-submission-hosted-rollback.sql` exercised the candidate against hosted staging PostgreSQL using the management/admin session inside BEGIN/ROLLBACK. It checked complete persistence, duplicate receipt, changed retry refusal, invalid second-line rollback and exact retry after a committed-in-transaction route switch. Independent cleanup SELECT: both candidate tables absent, candidate function absent, zero enabled staging streams. No runtime grants were installed.

This is not yet a hosted restricted-runtime, authenticated HTTP or real simultaneous-submission test. Local serialization and prior route-lock evidence do not substitute for those checks at this new wrapper. The trusted quote in these tests was synthetic administrator fixture data, not evidence of a production price authority.

## Remaining work and rollout

1. Exercise this wrapper with restricted staging credentials and concurrent same-request/same-quote submissions. Witness commit, rollback and lost-response retry; test failures with the actual HTTP adapter. Use the existing staging service/volume, finite budgets and disabled cleanup. No new paid resource is needed.
2. Define the production field mapping, authorization/pricing boundary and durable submission-key lifecycle. Adapt all retained checkout pages to the same atomic complete-basket command, or explicitly retire older pages. Review the writer-by-writer diff alongside admin, kitchen and response integration; `order-confirm` source remains unresolved.
3. Only after separate approval for production database writes/capture, install the reviewed private capture objects and establish a prospective baseline. Enable a bounded read-only observer first; verify persistence and health, then compare recommendation versus actual decision evidence over services. Unknown writers must continue to mark coverage incomplete. No live capacity authority transfers to Master Wok in that phase.

The core engine and bounded handover checks are already complete for their covered scope. Remaining effort is mainly this integration and its operational evidence, not another cooking-engine rewrite. A reliable completion date cannot be given while a retained live response handler's source and complete writer coverage remain unresolved.
