# Master Wok live-shadow readiness

20 October 2026. Goal: persistent observation and comparison alongside production, with no authority over availability or checkout.

Read-only production polling, persistent evidence and monitoring are in place from earlier rollout work. Polled saved state remains UNVERIFIED as decision history. Fully useful live shadow comparisons need reliable event-time capture of the complete booking lifecycle.

| Remaining work | Relative effort | Completion evidence |
|---|---|---|
| Delivery metadata and per-offer food-ready/arrival estimates in the transactional staging store | Medium; candidate SQL now passes rolled-back acceptance | Real planner -> restricted authenticated backend -> event store -> replay, with missing evidence remaining unverified |
| Cross-service-date changes | Medium | Atomic removal/addition, deterministic locks, retry/rollback and replay coverage tests |
| Capture all active order-changing paths and initial commitments | Largest uncertainty | Creation, proposals, customer/admin responses, cancellations and completion all accounted for; inaccessible/uncertain legacy paths resolved |
| Bounded end-to-end staging rehearsal and production observation rollout | Medium | Matching code/source identity, restricted access, persistent ACK/recovery, health/failure checks and verified default-off rollback |
| Operational validation | Several representative services | Quiet, steady and busy service comparisons, especially many small delivery orders; explain discrepancies before trusting recommendations |

Expect several further focused development/test cycles, followed by representative service observation. There is no defensible firm completion date until writer coverage and initial-baseline requirements are resolved. Most remaining effort is integration and evidence coverage rather than new scheduling arithmetic.

Live shadow does not require enabling Master Wok booking decisions, automatic delivery grouping or public checkout changes. Those remain later decisions after evidence review. Historical services without event history remain limited evidence; later manual corrections must not be backdated as if known when orders arrived.

Latest progress: delivery-event projection and arrival-based food-age handling are committed; private delivery-store SQL passed rolled-back database acceptance. The runtime remains at its previous disabled staging revision. Next concrete gate is the authenticated real-planner delivery-store trial, followed by cross-date work and remaining writer integration.
