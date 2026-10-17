# Delivery windows and combined runs — offline release, 17 October 2026

Implemented and locally tested. Not deployed or connected to live collection, availability or booking decisions. Production observer/collector code is unchanged. No routes API, Supabase query/write, customer locations, outbound messages, GitHub push or deployment was performed for this implementation.

## Agreed rules

Customer delivery time means doorstep arrival. Both deliveries independently have an inclusive ±10-minute arrival window. Food-ready-to-doorstep must be no more than 20 minutes; strictly under 15 is preferred, while 15–20 is flagged ACCEPTABLE_FLAGGED. Age includes kitchen holding, packing/loading, outbound travel, earlier handovers and waiting before the customer's arrival. Handover at that customer's own door is after arrival, but still occupies the driver. Both outbound and return journeys are directional; neither is inferred from the other. Plans do not establish actual cooking, customer acceptance or driver movements.

## Delivered implementation

master-wok-delivery-runs.js exports recommendDeliveryRuns(input, {assessKitchen}). The existing master-wok-delivery-shadow.js re-exports it and retains its exact-time helper, which now also enforces the 20-minute food-age cap. Neither module is loaded by the current live shadow collector.

The search supports one or two deliveries and one driver. It enumerates a one-minute arrival grid over each ±10-minute window. For two orders it evaluates separate trips plus kitchen → A → B → kitchen and kitchen → B → A → kitchen. Separate trips are checked against one another, not just existing reservations. Every trip includes loading, travel, handover, waiting and return. Existing driver reservations use half-open intervals: returning exactly when the next loading begins is allowed. Driver plans must be explicitly complete for the planning window. Earlier uncompleted work must be represented by the caller; this module cannot infer where the driver actually is.

All directional legs must be supplied, timestamped, fresh within an explicit threshold, and identified as duration estimates. Seconds round up to minutes. An explicit zero-duration estimate is permitted; missing duration is never substituted with zero. Distance alone is insufficient. Missing/stale/future estimates or incomplete coverage return UNVERIFIED, with no invented route.

Loading and each handover allowance, earliest permissible food-ready minute and minimum worthwhile combined saving are explicit caller inputs. Example values are test assumptions, not newly agreed operating policy. A shared-trip loading allowance must be sized for both orders by the caller. Driver returns after midnight are not supported by this version; such plans are excluded. Kitchen-ready time remains bounded to 16:30–22:00, independently of customer-facing opening hours.

## Kitchen integration contract

Every otherwise viable proposal invokes a synchronous assessKitchen callback ONCE with proposedFoodReady for all involved orders together. The callback must assess those orders jointly against existing kitchen commitments, collections, menu classification, holding rules and the decision snapshot. It returns FIT with a complete foodReadyByOrder array, NO_FIT or UNVERIFIED. Earlier cooking is permitted only when its additional holding time remains within the 20-minute delivery limit. Food ready after loading starts is rejected. Unknown, throwing, asynchronous or incomplete callbacks do not authorise a recommendation. Mutating a callback's proposal does not mutate caller input.

UPDATE: master-wok-delivery-kitchen.js now provides an offline joint adapter using the real conservative Master Wok model. See DELIVERY-KITCHEN-REVIEW.md for its fixed-allocation snapshot contract and limitations. It has not been connected to the live collector. Original routing tests retain synthetic callbacks; additional integration tests exercise the real kitchen engine. Without a supplied assessment there is no SHADOW_RECOMMENDATION. A FIT callback is planning evidence, not measured cooking.

## Selection and comparison

Within each kind, deterministic ranking favours all food ages under 15, then closeness to requested arrivals, maximum food age and total driver minutes. A combined run can be recommended when it improves the food-quality band, saves positive driver minutes meeting the explicit minimum, or is the only feasible option found. When separate trips keep all food under 15 but combined cannot, separate trips win. Savings compare against the selected feasible separate plan, not an unconstrained/global optimal route.

The output preserves separate and combined alternatives, visit order, arrivals, food-ready/departure/return times, quality flags, driver minutes and estimated saving. When no separate plan is feasible, savings are null rather than invented. Unknown kitchen assessments are reported by alternativesFullyAssessed=false. No claim of optimality across unknown proposals or minute fractions is made. The search does not offer a time outside the agreed ±10-minute window; later alternatives need a separately reviewed expansion rather than silently changing the promise.

All outputs remain verified=false, with evidenceBasis=HYPOTHETICAL_DELIVERY_PLANS_NOT_DRIVER_OR_COOKING_ACTIVITY. Even SHADOW_RECOMMENDATION is an offline candidate for review, not booking permission.

## Synthetic worked example

fixtures/delivery/two-nearby-stops-input.json and two-nearby-stops-result.json contain no real customer locations. Both customers target 19:00. Supplied duration estimates, two minutes combined loading, one minute per handover and a synthetic kitchen callback accepting both proposed times yield:

| Event | Planned time |
|---|---|
| Both orders food ready / loading begins | 18:46 |
| Depart kitchen | 18:48 |
| Arrive A | 18:56 |
| Arrive B | 19:00 |
| Return to kitchen | 19:08 |

A's food age is 10 minutes; B's is 14. Driver occupancy is 22 minutes, 16 fewer than the selected 38-minute separate-trip alternative. This is a test example, not a recommendation for real deliveries.

## Tests

56 Python tests pass. Eight Node test files pass in Europe/London and UTC, 53 runner entries per run (including legacy multi-assertion scripts). This update adds 21 routing/window tests and one exact-helper regression. Tests cover both stop orders, asymmetric returns, ±10 boundaries vs 11 minutes, under-15/exactly-15/exactly-20/over-20 boundaries, earlier cooking, separate-trip comparison, insufficient savings, combined-only feasibility, required legs, stale/duplicate/zero-duration estimates, joint kitchen rejection, unavailable/rejected async kitchen evidence, driver return conflicts, immutable deterministic outputs and 24 varied directional route matrices. THE_NIGHT_DAVID_DELIVERED_TO_HALF_OF_MORLEY is retained as a regression name.

## Next integration dependencies

1. Reliable directional travel estimates for ALL deliveries, including free ones, with a defined freshness/departure-time policy. Current production stores distance, not numeric journey duration; no capture change is included here.
2. A real joint kitchen assessment adapter and complete planning snapshots covering existing driver and kitchen commitments. Existing caller-supplied booleans are assertions, not independent proof of coverage.
3. Agreed packing/loading, handover and worthwhile-saving allowances. Food quality and ±10 limits are agreed; the other sample values are not treated as business facts.
4. Staging-only end-to-end validation using redacted delivery data, followed by explicit approval for any production shadow update. Do not upload these files to the live service just to activate them: the current collector does not consume them.

Leave current production shadow monitoring unchanged. Local folder replacement is safe; there is no need to push or deploy this offline release.
