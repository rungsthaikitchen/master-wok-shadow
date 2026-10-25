# Full checkout persistence candidate — 25 October 2026

The default-off offline adapter now connects the reviewed complete checkout shape to a new private atomic SQL submission candidate. It preserves all fields from the three inspected checkout pages, including discounts, loyalty, delivery distance, payment/communication preferences, notes, optional item notes and item ordering. The existing smaller synthetic submission is unchanged.

## Transaction and privacy

`FullSubmissionAttempt` calls the existing field mapper, freezes a JSON snapshot and submits only a fixed parameterized `submit_full_checkout` query through an injected trusted transport. Production project configuration is refused. Disabled construction does not inspect private fields or call a transport. Errors returned to the adapter caller are static codes, without underlying SQL/private data.

The new SQL file is an **offline candidate**, not a migration applied to either hosted project. It adds four private staging tables: trusted quote envelopes, route-wide submission receipts, complete order JSON snapshots and ordered item JSON snapshots. Each has RLS and no PUBLIC, anon, authenticated or service_role grants. No runtime grants or new policies are introduced. Both functions use SECURITY INVOKER and a fixed search_path with PUBLIC execution revoked.

For a new submission, SQL:

1. Locks the route in shared mode, then locks its enabled synthetic current stream, matching the existing cutover lock order.
2. Checks the route-wide receipt before quote expiry; an exact retry returns ALREADY_RECORDED, while a changed command is refused.
3. Matches the complete envelope against an unexpired administrator-provisioned quote for this route and checks that the quote has not been redeemed.
4. Independently checks source/version/field allowlists, column JSON types, request/order/item bindings, basket completeness and a resolvable target.
5. Writes the receipt, complete private order and each private item, derives the minimal engine basket from those same items and delegates to the existing booking/event transaction.
6. Requires a newly recorded booking. Any item, booking, outbox or late booking-receipt failure rolls back **all** these writes.

JSONB preserves JSON values, array order, explicit nulls and absent fields; it does not preserve object key order or numeric textual formatting. This candidate stores private snapshots, **not rows in a clone of production's typed public orders/order_items schema**. Production constraints, customer/address relations, triggers and downstream integrations are not thereby verified.

No engine projection is accepted as an input field. SQL derives only item IDs, quantities and modifier IDs. The browser retry UUID initially appeared in the event ID during testing; the candidate now derives an independent `full-` plus SHA-256 route/request identifier on the server. The raw request key, private order/customer UUIDs, names, notes, images, money, spice and preferences are excluded from the tested engine events. This derived identifier is not authentication or a substitute for a reviewed production pseudonymization policy. Menu IDs and the synthetic order alias are still trusted fixture inputs.

Delivery target means arrival at the door. Distance never becomes duration or food-ready time; deliveryReadyEstimate remains null. A reservation event is not an actual booking decision, cooking activity or driver activity.

## Explicit limits and unresolved production dependencies

- This is a synthetic fixture persistence path, not a public checkout endpoint. The project check is an offline configuration guard, not a network destination verifier. There is no database client, DSN, HTTP route, Railway runtime wiring or deployed endpoint in this change.
- Trusted quotes are test-administrator fixtures. Real customer ownership, menu/catalog authority, server pricing, coupon/loyalty validation, quote issuance and historical delivery-address binding remain unresolved. SECURITY INVOKER plus a trusted fixture administrator does not prove security against a compromised database writer.
- Financial discrepancies and extra precision remain exactly as submitted after matching a trusted fixture quote. The mapper reports discrepancies; this wrapper deliberately adds no pricing or discount rules. It does not approve those values for production.
- ASAP, null or invalid targets are refused before client transport and independently refused in SQL. This is a restriction of this isolated candidate; live ASAP checkout is unchanged. A reviewed ASAP target-resolution contract is needed before integration.
- Retry state survives calls through the same attempt object, not a browser reload. The caller must retain stable IDs. New writes need a live quote; a committed exact retry survives quote expiry, later offers and a same-day route cutover while the current route is enabled. Disabled routes refuse even retries.
- New tests use one local PostgreSQL/PGlite connection. The earlier hosted smaller-payload concurrency rehearsal is historical evidence only: full-payload hosted permissions, row-lock contention, timeouts and transport behaviour still need a fresh bounded rehearsal.
- Lifecycle writer coverage, order-confirm v22 source access, connected-day/multi-hop routing and continuous observer integration remain outstanding. Production booking lifecycle and notifications are unchanged.

## Verification and deployment sequence

41 Node test entries pass in **each** of Europe/London and UTC: 14 new persistence entries plus the existing mapper, smaller atomic candidate and submission adapter tests. Synthetic values are evaluated from the reviewed source-expression fixtures. Tests verify all three full shapes, exact snapshots and absence/nulls, unchanged financial discrepancies, rollback at the second private item/outbox/late receipt, a lost committed response and immutable exact retry, changed/expired/used quotes, malformed direct-SQL submissions, privacy canaries, delivery uncertainty, cutover retry and default access refusal.

No hosted schema, fixture, grants, flags, deployments, live orders or notifications were changed in this stage. No new cost was incurred.

Next: rehearse this candidate on the existing staging database inside a bounded rollback or temporary restricted trial, check the real runtime role and concurrent redemption, then revoke temporary privileges and verify disabled state. Production integration requires review of the remaining authorization, target-resolution and writer-coverage contracts; do not replace the live two-write checkout with this candidate yet.
