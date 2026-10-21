# Master Wok live-shadow readiness

21 October 2026. Goal: persistent observation and comparison alongside production, with no authority over availability or checkout.

Read-only production polling, persistent evidence and monitoring are in place from earlier rollout work. Polled saved state remains UNVERIFIED as decision history. Fully useful live shadow comparisons need reliable event-time capture of the complete booking lifecycle.

| Remaining work | Relative effort | Completion evidence |
|---|---|---|
| Delivery metadata and per-offer food-ready/arrival estimates in the transactional staging store | Medium; restricted authenticated real-planner trial now passes | Real planner -> restricted authenticated backend -> event store -> replay, with missing evidence remaining unverified |
| Cross-service-date changes | Medium; authenticated two-stream transfer and local crash recovery trial passes | Opposed authenticated moves, uncommitted snapshot, retry, return move and atomic ACK recovery; broader histories still unsupported |
| Capture all active order-changing paths and initial commitments | Largest uncertainty | Creation, proposals, customer/admin responses, cancellations and completion all accounted for; inaccessible/uncertain legacy paths resolved |
| Bounded end-to-end staging rehearsal and production observation rollout | Medium | Matching code/source identity, restricted access, persistent ACK/recovery, health/failure checks and verified default-off rollback |
| Operational validation | Several representative services | Quiet, steady and busy service comparisons, especially many small delivery orders; explain discrepancies before trusting recommendations |

Expect several further focused development/test cycles, followed by representative service observation. There is no defensible firm completion date until writer coverage and initial-baseline requirements are resolved. Most remaining effort is integration and evidence coverage rather than new scheduling arithmetic.

Live shadow does not require enabling Master Wok booking decisions, automatic delivery grouping or public checkout changes. Those remain later decisions after evidence review. Historical services without event history remain limited evidence; later manual corrections must not be backdated as if known when orders arrived.

Latest progress: delivery-event projection, arrival-based food-age handling and the authenticated private delivery-store trial pass. The trial used the actual planner with synthetic route fixtures; missing estimates remained unverified. Source fixture is disabled with zero reservations. Cross-date transfer SQL, paired replay, consistent export and atomic bundle acknowledgement now pass authenticated staging and local process-termination acceptance; the single-stream journal refuses transfer histories. Next gates are the zero-workload replay edge case, broader-history/freshness controller integration, live evidence binding/recovery coverage, and remaining writer integration. Production booking behaviour remains unchanged.

21 October update: the bounded authenticated cross-date trial passed with nine writer calls, three reads, ten source events and three transfer receipts. Process termination before ACK commit, retry and reopened local snapshot checks passed. Cleanup is verified disabled with zero fixture reservations and temporary grants revoked; see TRANSFER-AUTHENTICATED-TRIAL.md. The rice-only lifecycle fixture produces three UNVERIFIED recommendations, exposing a zero-Rung-work replay edge case; a separate curry sensitivity yields GREEN. This is not complete production capacity-validation coverage.

21 October offline follow-up: the server replay now explicitly handles baskets with zero calibrated and raw Rung workload, retaining reservations without inventing cooking jobs. The original authenticated capture re-assesses GREEN in London under this new build. Original durable trial results are not rewritten and no deployment was made. See ZERO-RUNG-WORK-REPLAY.md. The next integration gates are paired acquisition/freshness health, independent recovery coverage, wider connected histories, and active-writer/baseline completion.

21 October paired-monitor update: a default-off bounded staging entry point now connects fixed paired acquisition, durable comparisons, acquisition/failure/staleness health and content-bound object recovery. Single-stream transfer hints can explicitly route to a fresh paired acquisition; existing deployed wiring is unchanged. Injected-storage and independent-process restore checks pass; no real cloud/deployment trial has occurred. New provider rehearsal, wider connected histories, separate planning-evidence recovery and writer/baseline integration remain outstanding. See PAIRED-MONITOR-RECOVERY-REVIEW.md.

21 October real-provider follow-up: the paired monitor now passes an authenticated fixed-reader -> durable paired comparison -> existing bucket upload/readback -> new-file restore rehearsal on code 20d9dc996feca8c077ab8e6922d5fc4f61e223c3. A subsequent unchanged poll stayed healthy with one ACK and a cached recovery proof. Source fixture event/reservation counts were unchanged. The trial has been returned to default-off with temporary reader grants revoked; see PAIRED-MONITOR-RECOVERY-REVIEW.md for exact deployments and cleanup. Production remains unchanged.
