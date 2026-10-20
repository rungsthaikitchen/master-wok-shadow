# Delivery timing in chronological booking events

20 October 2026. Offline review candidate; no database or deployment changes in this step.

## Findings

The chronological replay already accepts delivery orders with an optional planner food-ready estimate. The private staging booking_rows table and create_booking() still force collection, and booking_payload() always emits a null estimate. They must not be enabled for delivery by changing the order-type constraint alone.

The real RTK planner supports arrivals within ten minutes of the requested arrival time. Replay previously measured food age as requested arrival minus food-ready time. That can understate age for a late arrival, or reject an acceptable early arrival. For example, requested 19:00, estimated arrival 19:10 and ready 18:45 is 25 minutes of food age, not 15. Ready 18:35 with arrival 18:50 is 15 minutes, despite being 25 minutes before the requested target.

## Implemented candidate

The existing deliveryReadyEstimate object can now optionally include arrivalAt. Replay preserves targetAt as the requested/proposed fulfilment target and uses arrivalAt for the food-age calculation. The estimate must remain on the London service date and within +/- ten minutes of targetAt. Food must be ready before arrival, with total age between two and twenty minutes for a usable kitchen assessment. Missing/stale estimates remain UNVERIFIED. Existing three-field estimates remain supported and retain the previous target-time fallback; these older records do not retrospectively gain an estimated arrival.

master-wok-event-delivery-projection.js derives event-bound estimates using the actual assessRtkDeliverySnapshot planner. It accepts one or two complete delivery reservation/decision events and their complete hypothetical planning snapshot. It requires matching service date, event/assessment time, order IDs, baskets and minute-aligned target times. Source event IDs are retained in the output mapping. It refuses existing populated estimates rather than overwriting evidence.

The planner retains its approved two-minute loading and customer handover allowances, return journeys, one-driver conflict checks, +/- ten-minute arrival window, under-fifteen-minute preference and twenty-minute maximum. Combined trips continue to require RTK's existing five-minute demonstrated saving rule. Missing direction/return legs or incomplete hypothetical driver/kitchen coverage produce UNVERIFIED. The bridge caps caller route freshness at thirty minutes and retains the tighter limit when supplied.

Output is ESTIMATES_PREPARED with verified=false, networkRequests=0, separate estimates and an explicitly hypotheticalDriverPlan. Input events and snapshots are not mutated. The bridge does not append events, update reservations, claim actual cooking/driving, or fetch routes. Its internal event-batch validation is a shape check, not proof that the source supplied a complete decision history. All of these APIs remain offline/default-off.

## Next private staging integration

1. Extend booking_rows with delivery type and target-bound planning evidence. Keep requested arrival, estimated arrival and food-ready time distinct. Retain route evidence references and estimation time with each offer/version; do not join later route evidence to an earlier historical decision.
2. Extend creation and offer commands atomically with basket, delivery metadata, reservation and immutable event. Derive estimates only from trusted server-side evidence. The bridge currently requires the same event/assessment timestamp; the transaction must establish that timestamp explicitly. Client-submitted estimates must not become authoritative.
3. A replacement arrival target needs a newly bound estimate or null/UNVERIFIED. Never carry an earlier offer's food-ready time across a target change automatically. Customer acceptance confirms that proposal version without reserving capacity twice or recomputing historical evidence.
4. Keep hypothetical driver plans separate from actual departures, returns or cooking. Complete hypothetical coverage is caller asserted and remains unverified. Production polled rows do not supply complete decision or activity history.
5. Test create -> offer -> repeat offer -> stale response -> acceptance/rejection -> terminal paths under the existing restricted writer before enabling a bounded staging trial. Keep older source captures and journals immutable; the changed replay build requires a fresh identity-bound trial journal.
6. Treat a move to another service date as a separate transaction design: both source/destination streams need deterministic locking and atomic transfer/replay coverage. No cross-date move support was added here, and no expiry rule was invented.

Production rollout still depends on complete active-writer coverage and a trustworthy initial baseline. This candidate does not resolve the live order-confirm visibility gap or alter any live booking route.

## Validation

- 173 Node tests passed under TZ=Europe/London and 173 under TZ=UTC.
- Nine focused booking/lifecycle tests passed in each timezone, including authenticated source captures from the previous staging trial.
- 55 Python event tests passed.
- New tests use the real joint kitchen/delivery planner, missing return evidence, mismatched baskets/targets/timestamps, incomplete driver coverage, stale/future routes, summer/winter conversion, cross-date refusal, +/- ten-minute limits and the exact twenty-minute food-age boundary.
- No Railway or Supabase mutation, infrastructure addition or route-provider request was made during this step. Existing staging runtime remains disabled at its previously deployed revision.
