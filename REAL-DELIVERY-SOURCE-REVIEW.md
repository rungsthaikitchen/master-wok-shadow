# Real delivery source adapter — ready for review, 17 October 2026

Prepared locally after the private synthetic staging worker passed deployment and restart checks. These new files are not committed, deployed or connected to a running observer. They do not change the kitchen observer, synthetic worker, checkout, availability or booking decisions.

## Implemented boundary

`railway-shadow/delivery_shadow_source.py` prepares a separate server-side read of saved orders and items using the existing Management read-only transport. The function is disabled unless enabled is literally boolean true, and only the known RTK staging/production project origins are accepted. Production use still requires approval of a specific rollout. No command-line entry point or runtime flag is wired into a service.

The fixed SELECT reads one atomic service-date snapshot, excludes is_test rows, includes confirmed/proposed/preferred time matches, and detects overflow with a 501-order / 5001-item sentinel. Maximum accepted data is 500 orders / 5000 items. The existing transport already refuses redirects and uses a bounded response and timeout. Runtime responses must prove supabase_read_only_user.

Before leaving Python, private raw order/item IDs are removed. HMAC aliases use a delivery-specific namespace distinct from kitchen collector aliases. A stable private pseudonym key is required for future persistence. Basket data is reduced to validated menu IDs, quantities and modifier IDs; extra fields and notes are discarded. Invalid selected timestamps—including empty strings—fail instead of falling back to preferred time. A state hash changes when saved state changes, but does not change just because a later poll observes the same state.

The database projection returns only a boolean for coordinate presence/range. It never retrieves coordinate values, customer names, phone numbers, email addresses or delivery addresses. A true boolean is not proof of a correct/geocoded address. Delivery fees become FREE/PAID/UNKNOWN; a free order follows exactly the same evidence checks as a paid one. No Google provider or route request is called.

`master-wok-delivery-evidence-audit.js` consumes the redacted snapshot. It is separately disabled by default. It records observed statuses, effective time basis (confirmed, proposed or preferred), London arrival target minute, fee band, location-evidence presence and explicit gaps. It rejects inconsistent counts, duplicate aliases, malformed baskets and unsupported source metadata. It does not generate cooking/driver commitments or call the delivery scheduler. Supplying a speculative existingPlan or legs field cannot bypass this boundary.

Output status OBSERVED means the saved-state audit completed. Prediction remains UNVERIFIED, recommendation is null, and verified is false. The absence of orders is not advertised as available capacity. Saved completed status does not prove physical cooking or a driven return journey. Unacknowledged proposed times remain explicit uncertainty. Cancelled/customer-declined rows are marked inactive; rescheduling outside the service day is excluded even when preferred time matched the original query date. Collection rows remain part of source coverage and never become driver reservations.

## Validation

- 124 Node test entries pass in Europe/London and UTC; 75 Python tests pass.
- New tests cover default-off/no-network, fixed bounded SELECT parameters, role proof, test-row filtering, duplicates/orphans, malformed and future timestamps, missing fields, HMAC privacy/namespace, state hash stability/revision, unknown types, empty days, effective-time precedence, pending proposals, free/paid parity and seasonal London clocks.
- A Python-to-Node test uses the real normalizer and confirms the audit returns route and commitment gaps without a recommendation.
- Read-only production metadata confirms order_type is text, delivery_fee numeric, and customer_lat/lng double precision. A five-second-bounded aggregate for 17 October returned zero non-test orders at the time of the check; no individual records or coordinate values were retrieved.
- An additional EXPLAIN-only validation attempt was rejected by automatic approval review, which interpreted the enclosed SELECT as returning individual records. It was not retried through another route. Actual execution of the new SELECT through a deployed read-only token remains a staging acceptance dependency. No permission changes were made.
- No GitHub push, Railway change/deployment, Google call or production write occurred during this phase. Existing synthetic worker runtime remains pinned to 4c7f4c6; the prior production kitchen observer is untouched.

## Smallest integration path

1. Commit only the new adapter, audit, tests and this review evidence to delivery-route-staging (expected parent e8e0a9d261d8f0f3c5f3e20c2eae28124524c8f1), with explicit push approval. Do not move main or the existing service pins.
2. Test the fixed source against staging with its read-only token and a controlled saved-state fixture. This source excludes is_test=true rows, so the six private synthetic cases are not a substitute for that acceptance check. Any staging fixture must remain separate from production and be clearly documented; do not silently reclassify the existing synthetic cases.
3. Prepare a dedicated, versioned evidence journal and health checks for these redacted real-order records. Do not store live-origin data in the synthetic journal or label readiness gaps as engine booking comparisons.
4. Review a concrete production-shadow rollout for this evidence-only path: separate service/volume, fixed read-only source, stable private alias key, bounded polling, unknown-evidence counters, backup/restore and token renewal. No live route calls are implied by approving source polling.
5. Add bounded directional route evidence capture with explicit Google budget/retention approval. Existing saved coordinates/distance do not contain outbound, inter-customer and return durations. Free deliveries must be covered too; checkout must never await these background calls.
6. Supply complete dated kitchen/driver commitments, tied to the same source revision, before attempting joint recommendations. Saved preferred/proposed/confirmed times alone cannot establish a complete cooking or driver plan, especially for a delivery whose time is doorstep arrival.
7. Only then review real Master Wok delivery recommendations against observed saved booking states, retaining CURRENT_SAVED_STATE_NOT_DECISION_HISTORY unless actual decision-time events exist. Later booking enforcement remains a separate approval.

No owner action or credentials are required to run the local tests. The next reviewable action is committing this preparation to the staging branch; no production deployment is proposed by this document.
