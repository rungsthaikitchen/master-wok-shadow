# Delivery booking-store candidate

20 October 2026. Tested inside a rolled-back private staging transaction. Not installed, deployed or granted to a runtime login. Production unchanged.

## Smallest change implemented

The candidate widens only private booking_rows.order_type to collection/delivery, adds dedicated create_delivery_booking() and apply_delivery_booking() functions, and adds delivery_plan_estimate() for input binding. Existing collection function definitions and public tables remain untouched.

Creation records a complete delivery basket and initial provisional reservation atomically. Offers/explicit confirmation bind an optional prepared plan to the exact command/event ID, order alias, target arrival and persisted basket. Its source evidence reference is synthetic/opaque. The full prepared-plan envelope is retained in the immutable command receipt, and the food-ready/estimated-arrival fields are included in the immutable source event. No current-row estimate is reused automatically: every new offer gets its supplied estimate or null. Missing evidence is retained as null so replay reports UNVERIFIED.

The estimate validator checks the expected field set, date/time syntax, same London service date, +/- ten-minute arrival window, two-to-twenty-minute food age, and an estimation time no more than thirty minutes old and never in the future. SQL validation proves internal consistency, not that a route was actually measured or the planner ran. routeEvidenceRef is not yet resolved against a durable evidence source. The acceptance fixture uses explicitly synthetic prepared evidence; it is not a provider or driver-activity validation.

Acceptance/rejection/cancellation/completion use the existing versioned apply_booking() path. Acceptance preserves the current provisional payload and flips its commitment without an additional reservation. Rejection removes it. Completion after rejection records ORDER_STATE_CHANGED, not a second release. The existing generic apply_booking() offer path would produce a null delivery estimate; it cannot inherit an old estimate through booking_payload(). The dedicated delivery function is required to supply bound planning evidence.

All new functions use SECURITY INVOKER, fixed search_path and public/anon/authenticated/service_role EXECUTE revocation. No runtime grants were added. The candidate adds no tables, triggers, domains or infrastructure.

## Validation performed

Project: hvrqgufqjslvgiohgkvu, private schema master_wok_event_test.

BEGIN -> candidate constraint/functions -> delivery-booking-acceptance.sql -> ROLLBACK passed, including:
- Invalid basket leaves no order/event; identical create/offer/accept retries add no capacity.
- Forced row-update failure after record() rolls back event, reservation change and command receipt.
- Wrong event version, basket or target, stale/future estimates and excess food age are refused.
- Replacement offer with no plan clears the estimate in the new reservation payload.
- Same target with an old event-bound plan is refused.
- Stale acceptance cannot confirm a replacement offer; acceptance of the current offer retains its exact estimate.
- Cross-date offer remains refused; rejection followed by completion leaves zero reservations.
- Planned delivery creation, explicit confirmation and active cancellation pass in a secondary rolled-back fixture.
- Existing collection create/offer/accept behaviour still passes with the candidate constraint.

Eight exported events were saved in fixtures/delivery-booking-staging-capture.json. Replay reports four comparisons, no remaining commitments and verified=false. In London, two estimate-backed offers produce hypothetical GREEN comparisons and two missing-estimate offers remain UNVERIFIED. The two new replay tests pass in London and UTC; all eleven focused lifecycle tests pass in London. Previously passing core suite (173 tests per timezone) and Python suite (55) were not rerun because this step changed only candidate SQL, fixtures and focused replay tests.

Cleanup query confirmed create_delivery_booking() absent, zero fixture streams, and booking_rows_order_type_check restored to collection-only. No persistent schema, permission, production data or Railway configuration changes were made.

## Next gates

1. Add a fixed-query, default-off staging backend adapter which derives plans with the real offline planner, retains/resolves the route evidence reference, and binds the output to the database basket and command ID. No client-supplied plan should become authoritative.
2. Exercise a bounded authenticated writer HTTP trial using a matching replay build and fresh journal. Any grants must stay private, column/function scoped and synthetic-stream limited. No production activation follows from the management-connection test above.
3. Separately implement cross-date transfer consistency and complete coverage of every live writer before claiming complete production decision history.
