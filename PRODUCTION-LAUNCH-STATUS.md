# Production launch status — 1 November 2026

**NO-GO for production. Legacy remains authoritative.** No production checkout,
production Supabase data/schema/functions, production Railway configuration or
main branch has been changed. Work is saved in three companion draft PRs.

## Implemented and joined

- Atomic checkout: actual menu baskets/modifiers, server pricing, discounts,
  customer binding, pending reward reservations, locked commitments, combined
  wok/fryer assessment, complete header/items, replay receipt, persisted plan and
  notification intent on one PostgreSQL connection. Failure rolls everything back.
- Global writer lock, idempotency lock and sorted date locks serialize bookings,
  lifecycle changes and service/blackout mutations. Durable release-specific mode
  is checked inside the lock. Drain waits for existing transactions to finish.
- Persisted plans protect already-started work, including downstream wok work for
  started frying. Cancellation keeps occupied resources and releases unstarted work.
  Missing in-service history fails closed; release needs pre-service plan seeding.
- Lifecycle: proposals hold original and suggested times until acknowledgement;
  response replay is stable and cancellation races cannot revive orders. New-order
  loyalty settles once inside completion. Legacy completion retains its callback.
- Notifications: immutable server-owned snapshots, opaque response tokens,
  per-channel durable claims, explicit-rejection fallback, accepted-channel dedupe,
  expiry/unknown-result quarantine, existing staff notification marker compatibility.
  Python worker reuses current templates. Legacy confirmation/reward side effects
  are fenced for Master Wok orders even after scheduler rollback.
- Delivery pricing: existing geocode/route contracts, fixed restaurant origin,
  server-derived coordinates, three-mile gate before the GBP30 free threshold,
  existing route bands and GBP3 routing fallback. Changed totals require review.
- Basket-specific read-only availability is joined through core HTTP, Flask,
  Pages proxy and existing time picker. It never saves orders/plans or reserves
  capacity. Checkout reassesses under its own lock. Prototype assessors cannot
  enable hints. Failed hints disable the picker; mode changes require refreshing.
- Checkout form and legacy routing are retained. Unknown booking outcomes keep
  the same key and never silently fall back to another writer. Rollback capacity
  compatibility retains both pending Master Wok time commitments across dates.

## Verified evidence and limits

- 203 JavaScript tests in both UTC and Europe/London; 21 Python tests; 12 browser
  client/proxy tests. Active inline scripts parse successfully.
- 37 scenario groups against actual private staging PostgreSQL, including
  concurrency, replay, rollback, protected plans, lifecycle races, loyalty,
  notification partial failures/crash recovery, delivery and read-only time hints.
  Latest evidence: STAGING-AVAILABILITY-RESULT.json. Earlier focused evidence is
  preserved in STAGING-DELIVERY-RESULT.json and STAGING-NOTIFICATION-RESULT.json.
- Real Python notification worker + actual templates + HTTP + staging database
  passed with fake provider acceptance. Second run found no work. No actual email,
  SMS or push was sent. See STAGING-NOTIFICATION-WORKER-RESULT.json.
- Mobile DOM checkout passes in both modes and when availability fails. The
  updated picker and checkout also ran through actual Pages functions locally,
  deployed Railway and Supabase: two HTTP200 availability calls, one complete GBP9
  order, zero separate browser writes and zero old confirmation calls. See
  HOSTED-AVAILABILITY-CHECKOUT-RESULT.json. This is not hosted Cloudflare certification.
- Hosted backend replay/drain/LEGACY restore passed earlier; original evidence:
  HOSTED-GATEWAY-STAGING-RESULT.json. Full website/privilege rollback is not certified.
- Generated fixtures are removed: all ten tracked private tables are empty.
  Temporary Edge test handlers are inert HTTP410 with JWT checks restored. Staging
  backend is restored to LEGACY; no real provider credentials were copied.

## Remaining release gates

1. Full menu/resource coverage and final service rehearsal. Confirm missing cooking
   method, minutes and maximum simultaneous portions for fish cakes, fried prawns,
   steamed dumplings, Thai sausage, spare ribs and fried eggs. Already known:
   spring rolls 7m; satay/moo-ping finish 1m; main frying 4–5m; rice microwave 1m
   before finishing. Integrate the independent starter/side work without chef prompts.
   Single-wok full-attention planning is conservative; multi-ring prototypes are
   not certified. The combined assessor still deliberately grants no production
   booking authority.
2. Resolve slowdown policy. Current website displays busy/very_busy notices and
   stores throttle values, but neither reviewed checkout nor admin Edge source
   applies them to capacity. Master Wok currently refuses those states. Do not
   invent duration/capacity multipliers or silently remove an intended slowdown.
3. Configure and test real staging Google/provider integrations, notification
   scheduling/backlog/error monitoring and production server/worker startup. Fixture
   responses certify contracts and transaction behavior, not external delivery.
4. Complete the actual hosted Cloudflare -> Railway -> Supabase rehearsal. The
   preview build succeeds but redirects to Cloudflare Access login. Preview access
   and staging backend environment configuration are needed. Include delivery,
   customer responses, printing, service changes and a realistic busy service.
5. Finish direct REST write fencing for every order/control path, capture exact
   deployed versions/privileges, seed plans and test full website/privilege rollback
   with existing Master Wok orders and unknown checkout attempts. Backend shutdown
   tests alone do not satisfy this gate.
6. Present the exact production release/rollback package for explicit approval only
   after these gates pass. No production enablement is requested yet.
