# Delivery staging data rehearsal — 17 October 2026

Completed: real staging Postgres rows → strict source adapter → real conservative kitchen/driver assessment → persistent staging comparison records → exact read-back. This is a controlled synthetic rehearsal, not an installed polling worker or production delivery shadow.

## Changes actually applied

Only Supabase project hvrqgufqjslvgiohgkvu (rtk-master-wok-staging) was written. Migration master_wok_delivery_staging_foundation adds nullable order_type, customer_lat, customer_lng and delivery_fee columns to staging orders. No defaults reclassify older fixtures. It creates the private master_wok_delivery_test schema with cases and observations tables, RLS enabled, and no anon/authenticated/service_role schema/table grants. No new public RPC or web endpoint exists.

Fourteen synthetic source orders and fourteen item rows cover six scenarios. Every inserted order is explicitly is_test=true, so the existing staging collector excludes them. Its non-test source cohort remains three existing fixture orders. No names, addresses, coordinates or customer data were copied from production. The routes in these cases are invented test evidence, independent of the previously completed six-request Google smoke test. The rehearsal uses a frozen 17:00 London assessment clock, not the actual time the tests ran.

The controlled test orchestrator used staging administrative SQL to read and persist results. It did not install a privileged application worker, create a runtime database credential or change existing app roles/policies. Runtime writer/read permissions must be designed separately before scheduling this automatically.

## Results

| Scenario | Result | Recommended run |
|---|---|---|
| Clear nearby deliveries | RECOMMENDED | COMBINED |
| Targets too far apart for sharing | RECOMMENDED | SEPARATE |
| Existing collection blocks cooking | UNVERIFIED: no feasible plan found | None |
| Existing driver trip blocks journeys | UNVERIFIED: no feasible plan found | None |
| Missing reverse inter-customer leg | UNVERIFIED: route evidence missing | None |
| Suggested time awaiting agreement | UNVERIFIED: unacknowledged proposal | None |

Two candidate records per scenario produce twelve persistent observations. Repeating the insert leaves twelve, not twenty-four. Every persisted JSON record matches the locally produced record exactly. Distinct source revisions produce different observation keys. Records carry source/build hashes, the approved RTK policy ID, candidate aliases, observed saved status, verdict, reason and selected run kind. They contain no basket, location, duration, arrival/finish schedule or raw provider response.

The observed statuses in these fixtures are confirmed/pending saved states; they are NOT exact booking decisions. All records explicitly say CURRENT_SAVED_STATE_NOT_DECISION_HISTORY, SYNTHETIC_STAGING and verified=false. UNVERIFIED is not a live refusal or evidence that food could not have been cooked. Hypothetical allocations do not establish actual activity. Production predictions/decisions have not been compared through this new pipeline.

## Validation

- 110 Node runner entries pass in Europe/London and UTC; 56 Python tests pass.
- Six database-backed scenarios match their expected verdicts and run kinds.
- Exact read-back of all twelve persisted records passes.
- Duplicate writes retain twelve records.
- Anonymous schema access and insert permission both false; RLS true.
- Database CHECK constraints reject incomplete records and verified=true records; those negative probes were rolled back.
- Source adapter requires the staging project, synthetic origin, atomic source basis, complete counts, explicit test flags, unique orders/items and complete existing-plan membership.
- Confirmed time takes precedence. Malformed times do not silently fall back; cancelled candidates, missing items, future creation, wrong service day and unacknowledged proposals fail closed.
- Fixed a database boundary issue: Postgres emits +00:00 whereas fixture evidence used Z. Both now canonicalise to the same instant before plan binding; genuinely stale evidence remains unverified.

## Code ready for review

New modules: master-wok-staging-delivery-source.js, master-wok-delivery-comparison.js and master-wok-staging-delivery-source.test.js. Supporting files: staging-delivery/schema.sql, read-source.sql, test_cases.js and generated-seed.sql. There are no production runtime edits. The staging source reader loads all source fields and items in a single SQL statement; it does not fetch customer-location fields. Do not run the schema/seed against production.

This source-only update is for the delivery-route-staging branch; its commit is recorded in the branch history. It does not deploy a worker. The Railway route-test service remains pinned to 8209ca20f76d9fb0314271cc117679b14232f8fc and disabled after the successful six-request run. The approved kitchen collectors remain on main at d1f370fc543e49130dae93a72932184aad728f4f. No additional routing requests or production Supabase writes occurred during this rehearsal.

## Remaining path

1. Review this staging source update and its recorded test evidence. The source-only commit adds no Google requests and does not change either collector.
2. Prepare an isolated repeatable background worker with a genuinely read-only source and a dedicated shadow-only durable journal, rather than a production database writer. Existing staging admin orchestration is not that worker.
3. Define how complete hypothetical kitchen and driver plans are produced from real observations, with explicit unknown coverage and exception handling. Saved order rows alone do not supply exact decision history or prove actual driver/cooking state.
4. Review budget/freshness/departure assumptions and provider retention for real routing evidence before more Google requests or real-route persistence. Current hard bounds remain ±10 minutes arrival, twenty minutes food-to-door, strictly under fifteen preferred, two-minute loading, two-minute handovers and at least five minutes demonstrated shared-run saving.
5. Review an exact runtime/source revision and deployment plan before any production delivery shadow change. Live availability/checkout remain out of scope.
