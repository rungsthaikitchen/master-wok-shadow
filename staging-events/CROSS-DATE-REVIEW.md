# Cross-service-date offer transfers

20 October 2026. Private staging candidate only. No deployment, runtime grants or permanent database changes in this work package.

## Behaviour

move_booking_offer() treats a move to another service day as a new provisional offer. It locks both stream rows in UUID order before any order rows, copies the complete basket into a destination projection, releases the source commitment and reserves the destination target in one transaction. Both immutable events use the same server timestamp and transfer ID. A global transfer receipt provides identical-retry idempotency and rejects changed commands.

RESERVATION_TRANSFERRED_OUT records the capacity removal without falsely calling the order cancelled/completed. RESERVATION_TRANSFERRED_IN records the destination offer, its new target, source date and new proposal event ID. Source handlers refuse further actions while that projection is moved_service_date. An older customer response therefore cannot reinstate the original day. Acceptance of the destination offer confirms the existing provisional hold without a second reservation. A later return to the original day can safely reuse its moved projection; a live/completed/conflicting destination projection is refused.

Original preferred-time metadata is retained. The destination row's created_at is the time that projection is inserted, not a replacement for the original order creation event. Capacity follows the event/reservation state, never those retained preferred/proposed/confirmed fields on a moved row.

Delivery estimates are explicitly null on incoming transfers. A different date requires fresh event-bound route/planning evidence through a subsequent delivery offer; the previous day's estimate is never copied. No expiry rule or actual kitchen/driver activity is inferred.

## Replay and persistence

The chronological validator/replay handles both transfer kinds, rejects duplicate transfer IDs within a stream, and assesses incoming offers as SUGGESTED. The local source drops outgoing holds and stores incoming holds. The event journal's observation binding and snapshot verification now include incoming transfer decisions.

validateTransferPair() is default-off. It checks complete individual histories, one counterpart on each day, identical transfer IDs/clocks, correct dates/order identity and an unchanged held basket/order type. Pairing is an evidence consistency check, not independent proof of database atomicity. A single-stream replay is still hypothetical and verified=false; it cannot certify that its counterpart was captured.

## Validation

- Main private PostgreSQL acceptance passed: forced failure after BOTH record() calls rolls back both histories, destination projection and receipt; identical retry; changed retry refusal; old source response/offer refusal; destination acceptance; transfer back; rejection/completion; occupied destination refusal; delivery estimate cleared; old delivery handler refused.
- The exported paired histories contain five source-day and three destination-day events. Both transfer pairs validate and replay; both finish with zero commitments.
- Additional record() guard checks passed in a separate smaller rolled-back transaction: non-null incoming estimate refused, valid null-estimate incoming offer accepted, duplicate transfer ID refused.
- 180 core Node tests pass in London and UTC. Seventeen focused staging tests pass in both timezones.
- 60 Python event tests pass. Regression includes actual paired-history ingestion, replay, durable observation binding, verify_store() and snapshot verification for both days. Pinned test dependencies were restored after the environment refresh before the final successful run.
- Cleanup checks confirm candidate transfer table/function absent, zero fixture streams and the installed record() definition unchanged. Source schema/function replacements used by acceptance were all rolled back. Existing disabled Railway staging runtime was not changed.

## Remaining gates before an authenticated trial

1. Add a fixed-query restricted transport and least-privilege transfer-table policy/grants. The candidate table has RLS and no runtime policies/grants; only management-connection acceptance is claimed here.
2. Export both affected histories and transfer receipts from one consistent database snapshot, then validate counterpart completeness BEFORE publishing/acknowledging a cross-date comparison. The current single-stream worker has no such cross-stream barrier; do not enable this candidate on it merely because it now recognises the event kinds.
3. Exercise simultaneous opposite-direction moves and normal actions using separate authenticated connections. UUID lock order is implemented, but a concurrent two-connection database test has not yet been run.
4. Include the new receipt evidence in persistence/recovery coverage, use a fresh build-bound journal, and deploy matching source/consumer contracts together with the trial disabled first.
5. Resolve current-stream routing and every live writer/initial-baseline requirement before production capture. This private schema does not change website date filters or public order lifecycle behaviour.

Candidate SQL files: cross-date-booking.sql plus matching record(), apply_booking() and apply_delivery_booking() definitions. Acceptance: cross-date-acceptance.sql and cross-date-record-guards.sql, each used with candidate definitions inside BEGIN/ROLLBACK. New record() and moved-row guards are not installed by committing these files.

Subsequent gate work: TRANSFER-BUNDLE-REVIEW.md supersedes the initial single-stream journal handling for new transfers. Intake/completion now refuse transfers outside the atomic bundle path. Consistent pair export and bundle snapshots pass initial acceptance; authenticated concurrency and broader live integration remain outstanding.
