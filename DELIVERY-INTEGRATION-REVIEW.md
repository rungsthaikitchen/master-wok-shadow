# Dated delivery shadow integration — 17 October 2026

Offline implementation and regression tests complete. Not connected to the running observer. No production/staging writes, deployments, GitHub pushes, paid routing requests or customer-address reads occurred. Both new entry points are disabled unless enabled is the boolean true.

## Implemented

**master-wok-delivery-routes.js** accepts one or two delivery aliases and an injected quoteLeg callback. Free and paid deliveries take the same path: pricing never suppresses journey evidence. One order requires two directional legs; two orders require six, including both customer-to-customer directions. Missing duration is never inferred from distance or the reverse journey. A partial batch is discarded. Strict duration strings such as 300s and 300.5s become seconds; the planner rounds them up to minutes. Explicit zero is supported. Responses must identify the requested direction, successful lookup, timestamp and the currently supported TRAFFIC_UNAWARE policy. Failures, rejected promises and per-leg timeout return redacted UNVERIFIED. The callback receives an AbortSignal for cooperative cancellation. Up to six sequential bounded calls; there is no automatic retry or refresh loop.

This is a capture/normalisation boundary, not an installed HTTP provider. Tests inject synthetic responses. A future provider must map aliases privately to trusted coordinates, obtain/verify timestamps and enforce budget/quota, cancellation, authentication and freshness. Only alias/duration/timestamp evidence leaves this boundary; provider addresses, coordinates, errors and extra fields are discarded. Response timestamps must be at or before assessedAt; actual asynchronous collection must complete before the final dated assessment is assembled, and its plan snapshot must then be bound to that same assessment instant. Do not backdate newly collected evidence to satisfy this check. An old route is rejected by the planner's explicit maximum age. TRAFFIC_UNAWARE is an estimate, not a promise about traffic; freshness alone does not make an estimate traffic-aware or appropriate for a later departure.

**master-wok-delivery-assessment.js** binds routes, candidate baskets, complete existing kitchen occupancy and driver trips into one dated assessment using the real conservative kitchen model. serviceDate and assessedAt must agree with the existing plan, with explicit Europe/London semantics. Summer/winter offsets work independently of the host timezone. Decisions before the service day or before kitchen opening use 16:30; same-day decisions round up to the next minute, including fractional seconds, to avoid cooking in the past. A past service day or decision after 22:00 is refused. Date selection, customer opening hours and ordering cutoffs remain a separate caller responsibility; this offline API does not authorise customer-facing slots.

The existing plan declares every existing order, its kitchen requirement/allocation and its driver-trip assignment. A collection cannot reserve a driver. Every existing delivery must appear exactly once in a driver trip, including shared trips. Unknown/missing membership and conflicting single-driver trips fail closed. Existing kitchen allocations remain fixed. Explicit kitchenRequirement=NONE requires a null allocation; it must come from a validated model classification, not an assumption that work finished.

IMPORTANT: the source of completeness is still a caller assertion. Structural cross-checking prevents internal omissions and contradictions, but cannot discover an order missing from the entire supplied manifest. This release does not reconstruct complete plans from production's polled final order rows. Existing plan validity, actual resource exceptions and consistent source loading must be established by a future snapshot producer. No claim of exact historical booking parity or confirmed cooking/driver movement is made.

**master-wok-delivery-cli.js** runs a bounded local JSON fixture through the integrated assessment, disabled by default. Example:

```sh
node master-wok-delivery-cli.js --enabled fixtures/delivery/integrated-two-stops-input.json
```

No provider or live source is installed in this runner. Input file size is capped at 1 MB; errors are redacted. An unverified assessment exits nonzero. The supplied fixture is synthetic, including empty existing commitments, route durations, baskets and handling allowances.

## Integrated worked example

The integrated-two-stops input/result fixtures now use the approved RTK allowances: two minutes loading, two per handover and five minimum minutes saved. Both arrival targets are 19:00. The selected shared run loads at 18:45, departs at 18:47, reaches A at 18:55 and B at 19:00, then returns at 19:09. The conservative model finishes cooking at 18:35 and 18:45. Food ages are therefore **20 and 15 minutes, both ACCEPTABLE_FLAGGED**. Driver occupancy saves 16 minutes against the selected separate alternative. See RTK-DELIVERY-POLICY.md and rtk-approved-policy-result.json for policy provenance. Every time is hypothetical; none establishes actual cooking, acceptance or a driven journey.

The kitchen engine searches an early feasible finish, not every finish that might improve freshness. Rejections can be conservative, and this release makes no global optimality claim. Existing kitchen holding remains ten minutes; the delivery cap is twenty, with strictly under fifteen preferred. See DELIVERY-KITCHEN-REVIEW.md for the fixed-allocation limitations.

## Validation

Full suite: **82 Node runner entries pass in Europe/London and UTC; 56 Python tests pass**. The new capture, integrated snapshot and CLI tests cover free versus paid deliveries, six directed legs, strict zero/fractional/missing duration, partial failure, timeout/cancellation, no leaked PII, default-disabled operation, complete kitchen/driver manifests, shared existing trips, fixed collections, return journey conflicts, same-instant snapshots, daylight saving offsets, fractional decision clocks, real joint cooking and the integrated two-drop example. Logs are included.

## Smallest staging path

1. Keep the approved production observer and checkout unchanged. Do not deploy this ZIP over the live service to activate delivery planning.
2. Supply a staging-only provider that reads pre-captured test route responses first; validate dated kitchen/driver snapshots from a complete redacted test manifest. The fixture runner is ready for this without credentials or API charges.
3. Before real route calls, review the alias-to-location source, secure provider access, request/cache budget and departure/freshness policy. Capture route durations independently of delivery charges, including free orders, in a separate background shadow path. Do not make checkout await new route work.
4. Apply the approved RTK profile: 2 minutes loading/packing, 2 minutes per handover and at least 5 minutes saved for a combined run. David confirmed these on 17 October. The RTK wrapper also refuses to invent a saving when no feasible separate baseline is found.
5. Add a separately versioned shadow-only delivery journal and health counters with source/build/route provenance and unknown-evidence counts. Do not mix its results into the existing kitchen-only records or treat saved statuses as exact decision history. Persistence for these new modules is not yet installed; the current production SQLite observer continues independently.
6. Review staging outputs and request explicit approval for any production-shadow runtime/source change. Production Supabase writes remain excluded. Off-volume backups and token rotation remain outstanding operational dependencies from the current limited trial.

No action or secret is needed from the owner to run the included offline tests. Live route capture and staging deployment remain separate work requiring the dependencies above.
