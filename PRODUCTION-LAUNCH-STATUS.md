# Production launch status — 1 November 2026

**NO-GO for production. Legacy remains authoritative.**

Base reviewed: `e86beafdca2c76ed8b40c7ab8dc0393297b48889`, branch
`review/go-live-capacity-adapter-2026-10-30`.

## Completed in review branches

- Atomic checkout joins real baskets, trusted server prices/modifiers/discounts,
  customer binding, pending loyalty reservations, capacity assessment, order/items,
  replay receipt, service plan and notification outbox in one PostgreSQL transaction.
- Global writer lock precedes idempotency and sorted service-date locks. Concurrent
  bookings, lifecycle changes and replay cannot bypass the same locked snapshot.
- Combined wok/fryer assessment includes dependencies, lead-time floor and buffer,
  customer/production hours, blackouts, cancelled/test exclusions and time proposals.
  Prototype feasibility still cannot approve a customer booking.
- Persisted service plans protect work already started, including downstream wok
  dependencies of started frying. Cancellation retains occupied resources and drops
  unstarted work. Missing historical plans during service fail closed; cutover needs
  a pre-service plan seed. No extra chef confirmation is introduced.
- Admin/customer lifecycle writer holds original and proposed times until response;
  acknowledgement is idempotent and cancellation cannot revive an order. New-order
  loyalty settles exactly once inside the completion transaction. Legacy orders
  retain the existing callback. New orders queue notifications transactionally.
- Flask review adapter exposes an explicit no-cache booking mode and authenticated
  booking gateway. Defaults remain LEGACY. Uncertain results never fall back to a
  second writer. No runtime settings have been changed.
- Website review code preserves the checkout form, selects the server mode before
  writes and uses stable retry keys. Unknown outcomes cannot silently create another
  order, including after rollback. Preview proxies require an explicit staging URL.
- Legacy capacity reader compatibility includes both pending Master Wok times across
  dates, tagged by capacity_scheduler. This column must precede website deployment.

## Verification

- 196/196 JavaScript tests pass in UTC and Europe/London.
- 11/11 backend Python tests pass with external calls isolated.
- 10/10 checkout-client/proxy cases pass, including retry, rollback compatibility,
  mode failure and preview-to-production isolation.
- 21 scenario groups pass against actual staging PostgreSQL using private
  master_wok_rehearsal tables. Coverage includes concurrent real baskets, rollback,
  replay, lifecycle races, real commercial validation, exact-once loyalty, fresh
  connection plan reload, started fryer/wok dependencies and cancellation protection.
  See STAGING-PROTECTED-PLAN-RESULT.json for deployment/hash and cleanup evidence.
- Mobile Chromium checkout passes in both MASTER_WOK and LEGACY modes with external
  providers intercepted. Master Wok makes one atomic request and zero separate browser
  database writes; legacy retains its original three mocked writes and confirmation.
- A browser-generated collection checkout request also passed through a controlled
  transport bridge into the actual private staging writer: one order, one item,
  one receipt and one queued notification, total GBP9. See
  BROWSER-CHECKOUT-STAGING-RESULT.json. This does not certify the deployed
  Cloudflare/Railway transport or real notification delivery.
- Generated fixtures were removed; all eight tracked private fixture tables are
  empty. Temporary certification handler is inert HTTP410 with JWT checking restored.
  No production writes or public staging order writes occurred.

## Minimum remaining work, in order

1. Install the real server HTTP runtime behind the gateway. Join trusted delivery
   lookup, notification sender/link tokens, live availability hints, service/blackout
   mutations and durable launch control to the same writer. The current combined
   assessor deliberately has no production approval authority. Current customer
   availability hints still use the existing conservative model.
2. Finish full-menu recipe/resource rules and existing busy/throttle parity.
   Unknown recipes and slower service states currently fail closed. Single-wok full
   attention planning is conservative; multi-ring prototypes are not certified.
3. Run the actual hosted Cloudflare -> Railway -> Supabase staging chain against a
   production-shaped schema. Cover delivery, rewards, notices/printing, admin moves,
   customer acknowledgement, blackouts, test orders, opening/production boundaries
   and a realistic service with started work. Use notification/payment sandboxes.
4. Rehearse durable cutover, direct REST write fencing, writer drain and rollback
   with existing Master Wok orders and uncertain checkout attempts. Capture deployed
   versions/privileges and seed committed plans before service. Local mode/reader
   rollback tests pass; a deployed rollback has not been tested.
5. Only after those gates pass, present the exact production release and rollback
   package for explicit approval. No production enablement is requested yet.

### Recipe facts still needed before full-menu certification

Previously recorded rules include seven-minute spring rolls, one-minute satay/
moo-ping finishing, four-to-five-minute main fryer cycles, and one-minute microwave
rice preparation before finishing. Do not ask the user to repeat these.
The remaining standalone recipes lack confirmed capacity-resource timing in the
reviewed code/history: fish cakes, fried prawns, steamed dumplings, Thai sausage,
spare ribs and fried eggs. Obtain cooking/reheating method, minutes and maximum
simultaneous portions. Standalone fried tofu/chips can use the conservative end
of the already stated fryer cycle, but confirm portion/basket equivalence when
finalizing starter coverage. Dumplings must not silently be modelled as fried.

## Production approval boundary

No production checkout, production Supabase, Railway production service, main
branch or existing authoritative scheduler was modified. Do not merge or deploy
this development work to production. Request explicit cutover approval only after
all remaining gates pass and a concrete release/rollback package is reviewable.
