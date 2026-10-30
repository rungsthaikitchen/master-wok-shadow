# Master Wok checkout commit boundary — staging implementation contract

Status: design checkpoint, NOT deployed and NOT an authoritative booking implementation.

## Verified staging schema (30 Oct 2026)
- public.orders: id UUID, created_at, preferred_time, proposed_time, confirmed_time, status, is_test, order_type
- public.order_items: id UUID, order_id UUID, item_id text, qty integer, modifiers jsonb
- No existing public/private booking/order/reservation SQL function found by name in staging.

## Required single-writer protocol
1. The checkout sends an idempotency key, full candidate basket, requested time and service date to an authenticated backend. Do not trust client-supplied classification or price.
2. Backend serializes decisions **per service date** using a database transaction-level lock, reads authoritative commitments, blackout state, and candidate lines, then evaluates Master Wok against a consistent snapshot.
3. A GREEN result is a *candidate* only. Commit the order header, its complete lines, and the capacity reservation within the same protected transaction. Return success only after commit.
4. AMBER or UNVERIFIED must not silently become GREEN; follow an explicitly designed staff-review or unavailable path.
5. Every writer that can create, move, cancel or accept a reservation must participate in the same serialization protocol. The existing direct browser/admin/customer time writes currently do not, so a standalone lock endpoint cannot guarantee correctness.
6. The idempotency key must uniquely identify a logical checkout attempt and replay must return the same committed result, not reserve capacity twice.
7. Booking changes must not change payment, loyalty, notification, discount or delivery semantics without separate regression tests.

## Important architecture boundary
The current JavaScript engine runs outside PostgreSQL. A transaction-scoped PostgreSQL advisory lock cannot remain held while a separate server process computes a schedule unless that same process maintains the database transaction on a dedicated connection throughout the calculation and write. A Supabase RPC that merely acquires/releases a lock before a separate HTTP assessment is **not atomic**. Do not implement that anti-pattern.

## Acceptance tests before rollout
- Two concurrent requests for the final feasible slot: at most one committed capacity reservation.
- Two identical retries with the same idempotency key: one reservation, stable response.
- Existing commitments moved to a proposed or confirmed time remain counted.
- Order header without complete order_items never becomes a committed reservation.
- Admin accept/suggest and customer acceptance cannot bypass the lock protocol.
- Staging failures and engine uncertainty do not silently fall back to overbooking.
- Feature flag off restores legacy behavior; rollback preserves already committed orders.

## Current blocker
Choose and implement a single authoritative booking writer and a transactional strategy for running the engine's capacity assessment against locked commitments. This document does not claim the current checkout meets that requirement.
