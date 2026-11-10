# Delivery scheduling — next release, not deployed

Production remains on the approved kitchen-only release. This branch is a new
DRAFT runtime and cannot inherit that release's production approval/certificate.

## Implemented

The customer's selected delivery time means arrival at the front door. The driver
planner allows the previously agreed +/-10-minute arrival window, reserves two
minutes loading, outward road travel, two minutes handover per stop, and a
separately quoted return journey. Kitchen deadlines move back to loading start.
Food readiness is independently checked against a maximum 20 minutes to the door.

One driver and separate trips are the default. An Admin recommendation compares
nearby pairs in both stop orders and must save driver time while fitting the
kitchen and existing commitments. Recommendations never reserve capacity.

The existing Admin gains a Delivery trip button. It previews recommendations or
a manually selected pair, displays stop order, departure, arrival and return, then
requires explicit confirmation. Combined trips and decision history are saved
with the service plan under the existing global booking lock. A plan revision
prevents stale confirmations. Subsequent collection/delivery bookings retain that
trip. Splitting rechecks both resources. Trips at or past loading start are fixed.
The initial UI supports two orders per combined trip.

Customer time proposals reserve both alternatives until acknowledgement. Test
orders and cancellations release unstarted demand; an already-started driver
journey remains occupied until its planned return. No new chef actions are needed.

Delivery hints now include fulfilment type and address. Changing either refreshes
or invalidates old hints. Free delivery still requires travel time; the existing
GBP3 pricing fallback is not permission to guess driver availability. Missing
route durations fail closed. Directed route estimates are cached for five minutes;
no departure-time traffic or real-time driver tracking is claimed.

Driver reservations live inside the existing transactional service-plan JSON;
no new production tables, dashboard or notification provider are introduced.
Booking IDs are remapped in kitchen jobs and trip stops together at persistence.

## Verification completed

- 260 core tests pass in UTC and Europe/London; 27 existing website regressions pass.
- Actual private PostgreSQL/HTTP runtime rehearsal passed booking/replay,
  recommendations, manual preview, atomic combination, split/recombine, stale
  revision rejection, later availability, concurrent driver conflicts (one winner),
  proposed times/customer acknowledgement replay, test release and drain.
- Real read-only existing Google-route Edge calls returned 371 seconds outward and
  381 seconds back from public Morley Town Hall. Both parse through the new adapter.
- Private rehearsal endpoint is inert with JWT enforcement. New isolated fixtures
  are retained as test orders; shared rehearsal mode remains LEGACY revision 18.
- No production writes or real notification sends occurred in this phase.

See DELIVERY-STAGING-RESULT.json and DELIVERY-REAL-ROUTE-RESULT.json. The PostgreSQL
rehearsal uses deterministic route durations; the real lookup is separate evidence.

## Remaining release gates

1. Chromium Admin and mobile checkout tests passed with intercepted services.
   Hosted checkout and Admin verification is still required.
2. Run the full hosted checkout/Admin flow using real route estimates and private
   staging data. Confirm free/paid delivery, route outage handling and timezone
   boundaries through the deployed runtime, not only individual adapters.
3. Recommendations now prefer routes under 15 minutes from food ready to door.
   Test combinations whose best kitchen placement differs from the driver's first
   feasible trip.
4. The rollback guard passed staging PostgreSQL checks. An additional disposable
   PostgreSQL rehearsal verified a revision-checked switch in the same transaction
   as the guard. Outstanding trips blocked the switch and preserved mode and revision.
   The full hosted routing rollback remains pending.
5. The cutover guard passed disposable PostgreSQL checks with a fixed London clock.
   A future booking and the 16:30 boundary blocked cutover. Test-only fixtures
   allowed the switch under the writer lock. Existing live commitments require migration.
6. Certify the exact new source and obtain explicit approval before changing the
   production checkout or production Supabase. All new delivery checks remain
   PENDING in the DRAFT certificate. No merge/deployment is authorized by old
   production launch approval.

## Review/test commands

Core: `npm test` (also with `TZ=Europe/London`).
Website: `node --test tests/*.test.cjs`.
Prepared browser tests: `node tests/delivery-admin-browser.cjs` and the existing
`tests/checkout-browser.cjs`, using the runtime Playwright installation.
The private staging runner is `staging-tests/delivery-scheduling-edge.js`; its
strong temporary authentication, expiry, staging-project guard and isolated schema
are mandatory. Never embed its temporary token in a committed artifact.

## 6 November staging evidence and cutover status

Runtime digest `3ff3ee4bea51d9ad06023ce7cc1e09aa81fdca589f846d2d9f0c0a23325d56e6`.
The hosted checks ran in separate sessions.

- Twelve mixed-service baskets booked, including delivery. Concurrent retries
  of the same delivery request produced one order.
- Pause and blackout each marked an otherwise available collection slot
  unavailable after the runner supplied the required order type.
- RTK-155 saved a 17:25 delivery proposal, RTK-156 stayed completed after a
  repeated completion request, and RTK-157 was cancelled.
- The opening-slot fixture booked at 17:00. A second basket received 409.
  Availability showed 17:00 unavailable and 17:05 available.
- One order-created event produced one simulated email, SMS and Pushover
  attempt. Replay found no work. No live provider calls were made.
- The rollback guard blocked on retained trips and unresolved delivery orders.
  A database dry run allowed the switch after simulating finished trips and
  resolving fixture proposals. The transaction was rolled back. This check
  does not constitute a full routing rollback.

Keep the delivery certificate DRAFT pending a complete mixed-service run
(including the oversized basket assertion) and full routing rollback evidence.
The production package for the earlier kitchen release is not approval for
this delivery release. Before requesting cutover approval, pin the exact
website and runtime deployments and their rollback targets. Apply the cutover
guard under the shared writer lock before 16:30 Europe/London and stop if
current or future commitments require migration.


## 10 November four-ring relaunch

The £50 incident basket and doubled £100 basket passed actual private Cloudflare checkout and Admin acceptance. Delivery promises represent door arrival. The £100 occupied-service lookup CPU failure was repaired through bounded search ordering, without changing holding or physical limits. See BASKET-REVIEW-STAGING.md and FOUR-RING-RELEASE-CHECKLIST.md for the exact source, evidence and remaining gates. The earlier activation record and single-wok draft certificate do not approve this four-ring release.
