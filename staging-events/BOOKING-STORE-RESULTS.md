# Production-shaped staging booking transaction — 20 October 2026

Implemented and exercised only in the private master_wok_event_test schema of staging project hvrqgufqjslvgiohgkvu. No production database write, public.orders hook, Railway configuration change, credentials change or deployment. Existing deployed staging runtime remains disabled.

## Changes

booking-store.sql adds booking_rows, booking_items and booking_commands plus three SECURITY INVOKER functions. This mirrors the relevant production UUID order IDs, separate item rows and status/preferred_time/proposed_time/confirmed_time fields; it is a narrow collection-order subset, not a full clone of customer, pricing, loyalty or payment data.

create_booking commits the complete controlled basket, initial pending-order provisional reservation, immutable source event and request receipt together. It cannot leave an order behind after a bad second item. The initial reservation is a hold for the requested time, not a customer-accepted offer; current_proposal_event_id remains null until an actual offer. Request IDs deduplicate exact retries and refuse changed payloads.

apply_booking locks the service stream before the order row, validates fields and the current proposal, writes the existing source reservation/event and updates the production-shaped row in the same transaction. It never calls the engine, network providers or notifications. Preferred time stays unchanged. A new offer immediately replaces the reservation and clears any old confirmed_time; customer acceptance confirms that same reservation. Rejection releases it and clears confirmation/proposal identity. The saved proposed_time is retained as metadata, not authoritative capacity. Thus simply using the old website helper against these fields would still be wrong; production consumers must use the reviewed reservation state/status rules.

The same command lock order serializes this single-service test stream and its sequence/watermark. This does not prove cross-service/cross-day ordering. No new parallel-client test was run for these wrappers; earlier source-handler concurrency evidence is separate.

## PostgreSQL acceptance evidence

booking-store-acceptance.sql runs inside one explicit transaction with final ROLLBACK. It checks:

- Invalid second basket line rolls back order, earlier item and event.
- Exact creation retry leaves one event; changed retry is refused.
- Pending request -> admin confirmation -> replacement offer preserves original request and moves capacity immediately, clearing stale confirmation.
- Acceptance retains exactly one confirmed reservation; exact retry adds no event.
- New proposal invalidates a reply to the older proposal without changing history.
- Rejection releases capacity; confirming a rejected offer without a new offer is refused.
- Cross-date offer is refused atomically, rather than silently dropping coverage.
- Reoffer/cancellation release the reservation and terminal orders refuse new commands.
- A temporary test constraint forces failure during the row UPDATE *after* record() writes the reservation/event. That command rolls back its event, reservation and receipt, preserving the previous confirmation. The constraint is removed within the test transaction and never persists.

All assertions passed on the final PostgreSQL run. The successful history contains eight events, including the initial requested-time hold, admin confirmation, three offers, acceptance, rejection and cancellation. Tests use synthetic aliases/baskets only. A readback after ROLLBACK confirmed zero booking rows, items, command receipts and test stream rows. The installed private tables/functions remain for review; no synthetic stream is left enabled by this test.

## Replay evidence

fixtures/booking-store-staging-capture.json preserves the actual first successful PostgreSQL export with its server timestamps. It contains no customer identifiers or addresses. The real replay engine consumed all eight events and produced four hypothetical GREEN comparisons with no remaining commitments under TZ=Europe/London. All results retain verified:false and networkRequests=0. Under TZ=UTC it conservatively returns SERVICE_TIMEZONE_REQUIRED assessments. Two regression tests pass in each timezone, including rejection of a changed proposal identity. No kitchen/driver activity is inferred from these results.

## Access review

RLS is enabled on all three new tables. Functions use SECURITY INVOKER and fixed search_path; public, anon, authenticated and service_role execution/access were revoked. A catalog check confirmed anon and the existing narrow runtime writer cannot execute the three new functions. Existing runtime grants were not broadened; the Flask adapter still points to the previous synthetic handler and cannot use this store yet.

The staging security advisor returned informational RLS-enabled/no-policy notices for the new private tables (plus two existing delivery-test tables). No policy is intentionally installed: application access is denied until a separately reviewed role/policy integration. See [Supabase's notice explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Adding a permissive policy solely to suppress the notice would defeat the current isolation.

## Deliberate limits / next integration

- Collections and one service date only. Delivery-ready evidence, cross-date migration, item edits, initial live-order baselines and complete legacy path coverage remain outstanding.
- Cancellation/completion after a reservation has already been released is refused by the reused event contract. A separate state-only transition is needed before supporting that case; do not invent a release for nonexistent capacity.
- Basket structure/quantity/modifier IDs are checked; this is not a trusted live price/menu catalog validator. Unsupported items must remain UNVERIFIED in replay. Creation does not claim a capacity-engine approval or capture browser-rejected checkout attempts.
- No expiry policy, token issuer, notification change or public API was added.
- Next: adapt the default-off backend transport to these new transaction signatures in staging with explicit narrowly scoped privileges, then test the full creation/offer/response path. No production activation is implied. These SQL files are staging development artifacts, not production migrations or instructions to run against production.

Follow-up: BOOKING-BACKEND-INTEGRATION.md records the subsequent reviewed staging-only writer grants and fixed-query adapter. The earlier no-execution-access statement describes the initial isolated schema stage.
