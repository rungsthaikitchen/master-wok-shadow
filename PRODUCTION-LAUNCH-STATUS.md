# Production activated — 4 November 2026

**LIVE at 08:51:36 GMT; MASTER_WOK revision 2. First hosted production booking and customer time acknowledgement verified.**

The owner-approved release passed its locked pre-service cutover. The complete reader-aligned commitment set was empty under the shared writer lock, so no legacy service plan needed seeding. Existing counts remain 1,480 orders and 5,835 items. No production order or notification was fabricated during smoke checks.

The production gateway deployment 5b510d17 is healthy and returns HTTP200 MASTER_WOK. Its read-only Brevo access check passed after owner authorization. The active dedicated worker f9ec0920 passed SMS/Brevo account checks and is polling normally. The certified production Edge returns HTTP200 basket-specific availability: 18:30 Wednesday is available, 16:55 before opening and Sunday are unavailable. Hints do not approve or reserve a booking. The expired very-busy setting is correctly ignored without changing the stored business control.

Website PR #66, backend PR #1 and core PR #2 are merged. Cloudflare Pages deployment d6ae8537 succeeded. Cloudflare blocks the automation host with HTTP403; the owner completed the actual hosted production checkout as RTK-1599. One immutable booking receipt and committed service plan were verified. The time suggestion from 18:30 to 18:35 was emailed once; the owner confirmed receipt and clicked acceptance. The order is customer_accepted_time with confirmed_time 18:35 and one acknowledgement receipt. Order-created email/Pushover and the acceptance confirmation are all recorded sent once with no errors. The test was then marked is_test=true through the certified lifecycle writer, preserving evidence while releasing its capacity and pending loyalty reservation without settling points. Final confirmation inbox receipt was not separately reported.

Regression evidence: 238 core tests in each of UTC and Europe/London, 42 backend tests and 27 website tests; staging Pushover, SMS/customer acknowledgement and email receipts confirmed. The source-bound certificate is CERTIFIED_FOR_PRODUCTION with runtime digest 021fb4dee715caeb07114f7eb8454ac59a6d46867c833bc1581283827b3d087f.

Guarded rollback retains all receipts, plans, outbox and loyalty ownership. Compatible baseline: backend d7ac8181 and website Pages d6ae8537. Drain under the shared writer lock and resolve pending time proposals before restoring LEGACY; never restore the pre-integration backend blindly. Hobby and Brevo IP protection remain enabled; a changed egress IP can require owner authorization after future deployments. See PRODUCTION-ROLLOUT-STATE.json for exact identifiers and limits.

## Previous checkpoints

# Production launch status — 4 November 2026

**Staging sign-off complete. Ready to request the exact controlled production rollout approval, including the Hobby egress operating approach. Production remains on the legacy scheduler; no rollout is yet authorized.**

The latest authenticated hosted checkout passed: private RTK-149, one chicken Green Curry, GBP9 less GBP5 loyalty reward = GBP4, with 100 points reserved only in the private fixture. The owner received the real kitchen Pushover and real outbox SMS, then accepted 4 November at 18:35 through the deployed response link. The database confirms customer_accepted_time, one acknowledgement receipt, and the approved confirmation email accepted by Brevo at 07:41 on 4 November. The owner confirmed inbox receipt; all three real channels and customer acknowledgement passed. No further SMS/Pushover/email is authorized after this successful send.

Brevo IP protection blocked the new worker. The owner authorized 152.55.177.0/24, but a subsequent deployment used 52.9.85.82 and was blocked. One subnet is therefore not a verified lasting solution. The staging-only bounded email process waited in its running container for owner authorization of 54.177.170.222, then passed the read-only account check and sent the exact approved event once. Backend regression count is 42. This does not change the production worker.

The existing production deployment was inspected read-only: commit 105b0845f3f4d50542d7daf575b2cd5642837669, deployed 23 October, same Brevo HTTPS API, no special relay found. The historical authorized-IP export contains both Railway and Amazon entries. Hobby can be retained with an explicit post-deployment access/authorization procedure, but that operating choice must be accepted; Pro or disabling account-wide IP protection has not been approved.

Private staging control is restored to LEGACY revision 18. RTK-149 is retained as is_test=true, preserving its accepted time and receipts. The temporary Edge is inert v23 with JWT enforcement. Disabled worker and LEGACY gateway closure deployments both reached SUCCESS; the public staging mode endpoint returns LEGACY/HTTP200. Production certificate remains DRAFT. See STAGING-FINAL-PROVIDER-REHEARSAL.json and the draft PRODUCTION-RELEASE-PACKAGE.json.

## Previous checkpoints

# Production launch status — 3 November 2026

**NO-GO pending final hosted provider rehearsal and exact production approval. Legacy remains authoritative; production checkout and Supabase have not been changed.**

The deployable runtime now joins basket assessment, atomic booking, lifecycle actions, delivery pricing, plan seeding and the notification outbox. Private whole-service tests covered 12 mixed baskets / 36 lines, concurrent same-key replay and distinct-key capacity conflict, time acknowledgement, completion, cancellation, service controls, cold fryer boundaries and rollback after a lost response. Real read-only geocode/route calls also passed with atomic delivery bookings.

Two concurrent notification workers delivered 28 fixture channels with durable deduplication. The dedicated Railway staging worker passed startup, authentication-error backoff and disabled standby checks. Real providers were not used in these worker tests. The earlier received SMS probe is separate evidence.

Regression results: 238 core tests in UTC and Europe/London, 39 backend tests and 27 website tests. Fixed spring-roll replanning, fryer warmup boundaries, uncertain checkout responses and UK SMS formatting. Production certification remains DRAFT and cannot authorize bookings.

Staging is restored to LEGACY revision 16, the temporary booking Edge is inert (v21, JWT enforced), and the worker is disabled. All 27 new release fixtures are test orders; RTK-119 and its queued messages remain unchanged. See STAGING-RELEASE-RUNTIME-RESULT.json for precise artifact and test limits.

The remaining owner steps are one bounded hosted flow with an approved kitchen Pushover, SMS acceptance and confirmation email, secure provider settings in the dedicated staging worker, and receipt confirmation. After that, certify the exact artifact and request approval for the concrete production rollout and rollback package.

## Historical checkpoints

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

2 November manual ticket check: David confirmed RTK-119 shows 4 November at 18:10. Ticket date/time is passed by user report. The actual restriction-list display confirmation remains pending; no production permission is implied.

2 November restrictions check: David confirmed the refreshed preview no longer
shows the loading error. Both manual checks are passed. Private launch control
was drained and restored to LEGACY revision 6; gateway deployment 949fe256
succeeded, and temporary Edge v13 is inert HTTP410 with JWT enforcement restored.
RTK-119 remains accepted for 4 November 18:10, with zero notification deliveries.

The backend now has a pinned Gunicorn startup candidate: actual WSGI app startup,
12 concurrent LEGACY mode requests and graceful SIGTERM passed locally, with
provider credentials absent. All 22 backend tests pass. Dedicated staging
deployment f13e5c9e succeeded at commit 87b9ca1, retaining LEGACY. Deployed
health and mode checks passed. No production settings or data were changed.
Real providers, deployed notification scheduling/monitoring, production runtime
composition and final full release/rollback certification remain gates.

## 2 November continuous notification-worker checkpoint

Backend review commit 6a4be76f126d9875b02fb551bc25f5844ff9d3e6 adds the
existing worker's `--loop` entrypoint, idle polling, bounded transport backoff,
SIGTERM/SIGINT shutdown and sanitized operational output. Startup checks transport
and time-link configuration before claiming. Quarantined expired sends now surface
`needs_attention` rather than an idle success. Historical uncertain sends remain
quarantined; no provider replay is added. Operator backlog SQL is documented.

All 27 backend tests pass. A real Python process woke its idle poll on SIGTERM
and exited cleanly in under three seconds. Disabled `--loop` refuses startup.
The worker remains undeployed/unconfigured; the staging web gateway stays pinned
to 87b9ca1 on Gunicorn in LEGACY mode. No provider was called. Production
configuration read returned only variable names and deployment metadata: Twilio,
Brevo and Pushover names exist; their values were not retrieved. Production
backend deployment remains 126fc57f (23 October); no production mutation occurred.

Next controlled provider check requires an explicitly approved mobile recipient
and authorization for one staging SMS using the existing Twilio account. Use a
one-off provider probe without claiming/draining RTK-119's five retained events.
Provider acceptance alone is insufficient; the recipient must confirm arrival.
This is a test approval, not approval for a production scheduler cutover.

Other independent release work remains: production assessor/runtime composition,
whole-service/delivery rehearsal, deployed worker and monitoring validation,
Cloudflare Access boundary verification and complete website/privilege rollback
certification. Do not present the SMS test as the only remaining launch gate.

## 2 November approved SMS provider checkpoint

David explicitly approved one test and supplied its destination. Staging probe
deployment e4a1cf10 at backend 8292d2c9 succeeded. The shared provider adapter
returned exactly one Twilio accepted-message result, and David confirmed handset
receipt. No order or outbox event was processed. Automatic container restart was
disabled for this one-off test. No second send or retry was attempted.

Normal Gunicorn startup restoration, probe disablement and clearing of the
temporary recipient/three copied Twilio settings were applied; restoration
deployment 955ea8e8 succeeded. HTTP200 LEGACY and normal Gunicorn startup were
verified, with no pending staged changes or probe result in restored logs.
Production was unchanged. This closes
the isolated SMS provider/handset check, not full deployed outbox worker validation.
Backend tests: 29. See STAGING-SMS-PROBE-RESULT.json. Full runtime composition,
whole-service/delivery and worker rehearsal, access boundaries and full rollback
remain release gates; no production cutover approval is requested.
