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

- Database write fence SQL covers orders, items, service state and blackouts,
  including service-role REST bypass. API roles cannot approve launch mode.
  Authoritative transactions require a direct trusted SQL role and transaction-local
  marker. Legacy SQL writes share the kitchen lock; drain blocks capacity changes
  while allowing narrow trusted staff-notification/loyalty bookkeeping. Notification
  dispatch locks the kitchen before outbox rows to avoid lock inversion.
- Existing admin status controls route through the gateway in Master Wok mode.
  Lifecycle responses identify server-owned notifications, suppressing duplicate
  browser sends. Legacy status/loyalty behavior is retained.

## Verified evidence and limits

- 219 JavaScript tests in both UTC and Europe/London; 21 Python tests; 23 browser
  admin/client/proxy tests. Active inline scripts parse successfully.
- 53 scenario groups against actual private staging PostgreSQL, including
  concurrency, replay, rollback, protected plans, lifecycle races, loyalty,
  notification partial failures/crash recovery, delivery and read-only time hints.
  Latest evidence: STAGING-FULL-MENU-RESULT.json. Fence evidence: STAGING-WRITE-FENCE-RESULT.json. Recipe evidence: STAGING-THAI-SAUSAGE-RESULT.json. Prior recipe evidence: STAGING-CONFIRMED-RECIPES-RESULT.json. Availability evidence: STAGING-AVAILABILITY-RESULT.json. Earlier focused evidence is
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
- Actual authenticated Cloudflare-hosted checkout now passes: RTK-119, one £9
  Green Curry/chicken item, matching booking receipt, persisted 17:55–18:00 job
  and one pending notification event with zero deliveries. The user saw the
  existing confirmation UI. Production has zero matching fixture customers/orders
  (SELECT-only check). See HOSTED-MANUAL-CHECKOUT-RESULT.json.
- Staging drain returned HTTP503; the restored gateway deployment c30f0278 is
  SUCCESS and returns LEGACY/HTTP200. Order, receipt and plan digest are unchanged.
  Temporary writer v9 is inert HTTP410/JWT-protected. Fixture retained for review;
  private write fence remains installed in LEGACY. No real providers ran.


## Remaining release gates

1. Complete a realistic final-service rehearsal using the now-covered menu. All
   44 current priced menu items have individually committed in staging; mixed rice,
   starters and dependency restart are joined. Rice reheating is conservatively
   rounded to three minutes per serving. See CONFIRMED-KITCHEN-RECIPES.md and
   STAGING-FULL-MENU-RESULT.json. Extra chef capacity is not assumed.
2. Busy policy is now decided and implemented: Busy +15 minutes, Very Busy +30
   minutes, with unchanged cooking durations/capacity. Verify the existing hosted
   admin controls and customer messages in the release rehearsal.
3. Configure and test real staging Google/provider integrations, notification
   scheduling/backlog/error monitoring and production server/worker startup. Fixture
   responses certify contracts and transaction behavior, not external delivery.
4. Complete the actual hosted Cloudflare -> Railway -> Supabase rehearsal. The
   preview mode check now reaches Railway after correcting Workers-incompatible
   redirect options, reproduced in real local workerd. David completed the authenticated collection checkout; remaining hosted admin,
   customer-response, provider, delivery and printer paths still need rehearsal. Include delivery,
   customer responses, printing, service changes and a realistic busy service.
5. Deploy and certify the reviewed write fence and admin routing in the full hosted
   environment, capture exact deployed versions/privileges, seed plans and test
   full website/privilege rollback
   with existing Master Wok orders and unknown checkout attempts. Backend shutdown
   tests alone do not satisfy this gate.
6. Present the exact production release/rollback package for explicit approval only
   after these gates pass. No production enablement is requested yet.

## Current admin rehearsal checkpoint

The temporary private runtime v10 now reuses createBookingRuntime and existing
lifecycle/mutation assessment. RTK-119 was proposed from 18:00 to 18:05 with two
capacity commitments, accepted through the deployed Railway customer link, then
replayed without duplicate receipt/notification. One commitment remains; three
outbox events and zero deliveries. Foreign-order mutation was refused. The prior
checkout drain/restore evidence above remains historical; staging is temporarily
MASTER_WOK again until 22:05 UK time for the manual admin screen check.

Preview admin proxies now honor the staging backend and refuse implicit live
routing. The existing admin screen lists only the run's fixture orders in Preview;
production's reader remains unchanged. Pages deployment 9791ee37 and Railway
5e7e6734 both succeeded. Core tests (219), admin/client/proxy tests (23), three
admin inline scripts and five actual local workerd proxy checks pass. Actual
Cloudflare admin UI POST is the next manual step, not a completed claim. See
STAGING-ADMIN-REHEARSAL-RESULT.json and PREVIEW-REHEARSAL-STATE.json.

2 November renewal: the same isolated admin rehearsal is reopened until 09:17 UK time today (Edge v11). RTK-119 remains customer-accepted at 18:05 on 4 November; zero notification deliveries. Manual admin Suggest is still pending. Production remains unchanged.

## 2 November service-control checkpoint

David's actual Cloudflare admin Suggest for RTK-119 at 18:10 succeeded. The
database held 18:05 and 18:10 until acknowledgement; the deployed Railway customer
link then confirmed 18:10, leaving one commitment, two response receipts, five
notification events and zero deliveries. No duplicate browser notice was sent by
the server-owned path.

The screenshot exposed failed restriction reads: in MASTER_WOK mode Flask still
used a legacy REST reader. Control reads now use the same authenticated writer
operation/schema as mutations, and the customer service-state Pages proxy honors
the staging backend. Pause/read/hint, restriction create/list/block/deactivate,
server-clock expiry and normal restoration passed against deployed private staging.
Backend deployment 382b8049 and Pages 80ce2b0c succeeded. Local checks: 223 core,
22 backend and 25 admin/client/proxy tests; six real workerd proxy checks; three
admin scripts parse. Master Wok accepted-time labels now ignore retained proposal
history. Actual preview refresh and physical print at 18:10 are next manual checks.
See STAGING-SERVICE-CONTROL-RESULT.json. Production remains NO-GO and untouched.
