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
  second writer. No production runtime settings have been changed.
- Website review code preserves the checkout form, selects the server mode before
  writes and uses stable retry keys. Unknown outcomes cannot silently create another
  order, including after rollback. Preview proxies require an explicit staging URL.
- Legacy capacity reader compatibility includes both pending Master Wok times across
  dates, tagged by capacity_scheduler. This column must precede website deployment.

## Verification

- 199/199 JavaScript tests pass in UTC and Europe/London.
- 20/20 backend Python tests pass with external calls isolated.
- 10/10 checkout-client/proxy cases pass, including retry, rollback compatibility,
  mode failure and preview-to-production isolation.
- 31 scenario groups pass against actual staging PostgreSQL using private
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
- Generated fixtures were removed; all ten tracked private fixture tables are
  empty. Temporary certification handler is inert HTTP410 with JWT checking restored.
  No production writes or public staging order writes occurred.

## Hosted gateway and shutdown follow-up

The actual Flask review branch was deployed into a new staging-only Railway
service, fd320f7b-3e1d-4b07-970c-74b75fdc82d3. Its source is pinned to commit
9dc12b1dfa8703f4abec791053fa797e0fc398d9. No production/database/notification
credentials were copied. Mobile checkout executed the real Pages proxy functions
locally, reached deployed Railway and the authenticated staging Edge handler, and
created one complete GBP9 order. Replaying its key returned the original receipt.

The shared runtime now composes checkout, lifecycle, service controls and a private
durable launch gate. Every writer rechecks release/mode AFTER the global lock.
The PostgreSQL drain test observes the drain waiting on an actual advisory lock
held by an in-flight order. A stale release and post-drain bookings fail closed.
Service-state and blackout writes use the same lock and preserve legacy values.
Busy/very-busy capacity semantics still need assessor parity; those modes remain
blocked by the assessor. No prototype receives production approval authority.

Through deployed Railway, DRAINING refused mode and booking requests with HTTP503;
restoring LEGACY produced mode LEGACY and disabled POST /book-order with HTTP409.
The staging service is left in LEGACY (successful deployment
 aec54b09-ce72-4e7f-a250-b6d9e59354c6). Both temporary Edge handlers are inert
HTTP410 with JWT verification restored. Fixtures were removed. This is a tested
backend shutdown/restore, not yet a full website/privilege rollback certificate.

Evidence: STAGING-RUNTIME-DRAIN-RESULT.json (25 database scenario groups) and
HOSTED-GATEWAY-STAGING-RESULT.json (actual hosted gateway). The Cloudflare preview
build succeeded, but its URL redirects to Cloudflare Access login. No protection
was bypassed. Actual hosted Pages configuration/access is still required.

## Notification integration follow-up

Checkout/lifecycle transactions now queue server-owned message snapshots with
opaque response tokens. The dispatcher leases work and records each channel before
sending. Accepted channels are not resent; explicit rejection may use the existing
customer fallback. Expired/unknown sends are quarantined rather than duplicated.
Legacy staff notification markers are preserved. Old browser confirmation/reward
side effects are fenced for Master Wok orders even after mode rollback.

The Python worker reuses the existing templates through a render-only path and
uses dedicated worker authentication. It passed a real HTTP/private-database
rehearsal with fixture email/push providers; a second run found no work. No actual
SMS/email/push was sent. 31 database scenario groups and 20 Python tests pass.
See STAGING-NOTIFICATION-RESULT.json, STAGING-NOTIFICATION-WORKER-RESULT.json and
the backend MASTER-WOK-NOTIFICATIONS.md. Temporary handlers are disabled; all ten
tracked fixture tables are empty. Production remains unchanged.

Notification code is implemented, but deployed worker scheduling/monitoring,
provider sandbox acceptance and full hosted lifecycle/rollback are not certified.
A pending/uncertain notification requires operational visibility; no chef screen
or extra chef confirmation has been introduced.

## Minimum remaining work, in order

1. The authenticated runtime composition and hosted gateway are tested; install the
   final certified release runtime and join trusted delivery
   lookup, provider sandbox acceptance and worker scheduling/monitoring, live availability hints, service/blackout
   mutations to the same writer; durable launch control is now implemented and rehearsed. The current combined
   assessor deliberately has no production approval authority. Current customer
   availability hints still use the existing conservative model.
2. Finish full-menu recipe/resource rules and existing busy/throttle parity.
   Unknown recipes and slower service states currently fail closed. Single-wok full
   attention planning is conservative; multi-ring prototypes are not certified.
3. Run the actual hosted Cloudflare -> Railway -> Supabase staging chain against a
   production-shaped schema. Cover delivery, rewards, notices/printing, admin moves,
   customer acknowledgement, blackouts, test orders, opening/production boundaries
   and a realistic service with started work. Use notification/payment sandboxes.
4. Finish durable cutover, direct REST write fencing and full deployed rollback
   with existing Master Wok orders and uncertain checkout attempts. Capture deployed
   versions/privileges and seed committed plans before service. Local mode/reader tests and hosted backend drain/restore pass; the full website
   and privilege rollback remains untested.
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
