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

1. Run real browser tests (prepared in the website branch). Chromium is absent in
   this environment and its download returned an invalid archive. Neither the new
   Admin interaction nor changed checkout events have browser sign-off.
2. Run the full hosted checkout/Admin flow using real route estimates and private
   staging data. Confirm free/paid delivery, route outage handling and timezone
   boundaries through the deployed runtime, not only individual adapters.
3. Recommendations now prefer routes under 15 minutes from food ready to door.
   Test combinations whose best kitchen placement differs from the driver's first
   feasible trip.
4. Rehearse `sql/delivery-rollback-guard.sql` against outstanding commitments.
   Run it in the same transaction as the revision-checked mode update. It
   requires DRAINING and blocks on outstanding trips or delivery orders.
   The guard passed a staging PostgreSQL check with temporary fixtures. A full routing rollback rehearsal remains pending.
5. Rehearse pre-service migration of existing kitchen-only delivery commitments,
   or require an empty future delivery commitment set under the writer lock.
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
