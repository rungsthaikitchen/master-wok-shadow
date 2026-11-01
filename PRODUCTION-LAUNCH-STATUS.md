# Production launch status — 1 November 2026

**NO-GO for production. Legacy remains authoritative.**

Base reviewed: `e86beafdca2c76ed8b40c7ab8dc0393297b48889`, branch
`review/go-live-capacity-adapter-2026-10-30`.

## Implemented together

- Joined existing transaction, raw basket canonicalization, locked snapshot,
  availability and order persistence at `master-wok-atomic-checkout.js`.
- Concrete server-side writer inserts header, all lines and immutable idempotency
  receipt on the same dedicated PostgreSQL connection. Original order ID/response
  is returned on replay; changed-date key reuse fails closed.
- Transaction begins in READ COMMITTED, takes key then service-date locks, applies
  database timeouts, and rolls back on failed assessment or persistence. Explicit
  `bookingApprovalAllowed=false` cannot write even with a GREEN status.
- Existing wok search now checks fryer feasibility at each complete arrangement;
  alternative wok arrangements are searched within explicit bounds. Fryer work
  has per-order/item attribution, capacity/deadline checks and seven-minute spring
  rolls behind an opt-in. Unmodelled recipes remain blocked.
- Spice and item notes participate in batching compatibility and survive the
  canonical/read boundary. Previous-day preorders release at service-day midnight.
- Whole candidate wok/fryer span, ten-minute provisional buffer, cold fryer lower
  bound, production hours, customer/overflow hours, closures, test exclusions and
  locked control-state checks are joined in `master-wok-combined-assessment.js`.
- The combined assessor deliberately does not grant production booking authority.
  Slower service states fail closed pending parity with the existing backend.

## Verified

Baseline was 152/159 in Europe/London and 146/159 in UTC. Seven failures reflected
an incomplete spring-roll opt-in or a stale query-argument assertion; six further
UTC failures used UTC instants as local-clock fixtures. These are corrected without
weakening unknown-recipe or booking-authority guards.

The complete Node suite now passes 171/171 in both UTC and Europe/London. New integration
checks cover raw basket, lead time, spring-roll opt-in, unknown recipe, blackout
exclusive end, pause/throttle, spice/note compatibility and prior-day placement.

A temporary authenticated Edge runner executed the **actual JavaScript checkout
transaction and kitchen assessment against staging PostgreSQL**, using private
`master_wok_rehearsal` tables and generated menu-shaped baskets. The test-only
commercial validator uses fixture prices and cannot be used for live orders.
The test-only authority wrapper is confined to these private rehearsal tables.

12 scenario groups passed (HTTP 200, staging pg_net response 2):

1. Concurrent final-capacity baskets: exactly one complete header/items/receipt.
2. Idempotent replay returns original order ID; cross-date key reuse conflicts.
3. Error after header/items/receipt persistence rolls back every record.
4. Concurrent identical retries create one order.
5. A mixed curry and crispy-chicken basket commits atomically.
6. Prototype GREEN without authority is refused; legacy mode selects old path.
7. Locked blackout state refuses the booking.
8. Cancelled order releases capacity.
9. Test order does not consume real-order capacity.
10. Proposed time is counted at its effective time.
11. Confirmed time is counted at its effective time.
12. Incomplete existing header fails closed.

These lifecycle checks read state changes made in isolated fixtures. They do not
certify the real admin/customer mutation endpoints or time acknowledgement flow.

All generated rehearsal headers/items/receipts/blackouts were confirmed removed.
The runner was replaced with a disabled HTTP 410 implementation and JWT checking
restored. `pg_net` was enabled in staging to invoke it; no production DDL or data
writes occurred. Existing public staging orders were not written.

## Minimum remaining work, in order

1. **Backend access / actual checkout integration.** GitHub returns 404 for the
   Railway-configured private `rungsthaikitchen/order-backend` repository. Need
   read/development access through the GitHub connection. Current website and
   Cloudflare proxy sources were inspected read-only. Commercial validation
   (prices/modifiers, delivery, discounts, loyalty and customer binding), payment
   and notifications must use actual backend rules, not the rehearsal validator.
2. **One writer for every lifecycle mutation.** Route checkout, admin accept/
   suggest/status/test changes, customer time acknowledgement, blackouts and
   service-control changes through the same locking protocol. For moves across
   dates lock both dates in deterministic order. Prevent direct REST bypass only
   as part of the approved cutover. Retain old/new time commitments appropriately
   while awaiting acknowledgement; do not guess the private backend's statuses.
3. **Running-service continuity and full menu.** Persist/protect committed work
   plans so already-started work cannot be moved. Confirm remaining standalone
   fryer recipes and independent starter/egg resource times, finalize holding/
   buffer rules, and implement the current busy/throttle policy. Single-wok full
   attention planning is conservative; multi-ring prototypes are not certified.
4. **Full browser/production-schema staging rehearsal.** Staging's public order
   schema is reduced. Test real checkout, totals, delivery, loyalty, notices,
   printing, admin changes and customer acknowledgement on a production-shaped
   staging fixture with notification/payment sandboxes. No real customer sends.
5. **Controlled cutover/rollback.** Add a trusted durable server launch switch and
   a writer-drain procedure. Capture current Cloudflare/backend/function versions
   and privileges. Verify rollback with committed Master Wok orders still visible
   to legacy capacity via their existing kitchen_load fields. The factory's LEGACY
   setting is tested; a full deployed website/backend rollback is not yet tested.

## Production approval boundary

No production checkout, production Supabase, Railway production service, main
branch or existing authoritative scheduler was modified. Do not merge or deploy
this development work to production. Request explicit cutover approval only after
all remaining gates pass and a concrete release/rollback package is reviewable.
