# Master Wok live-shadow readiness

21 October 2026. Goal: persistent read-only comparisons alongside production, with no authority over availability or checkout.

Earlier production saved-state polling remains limited evidence: it does not establish decision-time history. The new lifecycle comparison path is tested in private staging and remains disabled after each rehearsal. No new production capture or scheduling behaviour has been enabled.

| Capability | Current evidence | Remaining work |
|---|---|---|
| Proposed-time lifecycle | Transaction/outbox, signed stale-response refusal, retries, cancellation/completion tests and restricted-login trials pass | Exact mapping of every deployed legacy writer |
| Delivery estimates | Real planner with synthetic routes -> restricted staging store -> replay passes; missing estimates stay unverified | Live evidence binding and recovery of separately retained planning evidence |
| Cross-date changes | Opposed authenticated moves, paired consistent export, retry/return move and process-termination ACK recovery pass | Connected histories beyond exactly two non-empty streams |
| Zero Rung workload | Opt-in server replay handles rice/Sam-only baskets without inventing cooking jobs; existing scheduler defaults preserved | Review as part of wider service observations |
| Paired monitoring/recovery | Real staging reader -> durable pair -> existing bucket readback/restore passes; unchanged poll reuses one ACK and proof | Production retention/request policy and full end-to-end source integration |
| Initial cutover | New explicit saved-state baseline seeds held and unreserved known orders; future-only replay and durable recovery tests | Private hosted capture/rollback/lifecycle tests pass; real concurrency blocked on Railway write authentication; routing and connected-stream cutover remain |

The paired-monitor provider rehearsal used code 20d9dc996feca8c077ab8e6922d5fc4f61e223c3. Cleanup deployment 80e725d2-3376-4ead-9f27-5b3cb9dfa57c reached SUCCESS and logged DISABLED/sourceRequests=0. Fixtures are disabled, zero reservations remain and temporary reader transfer grants are revoked. See PAIRED-MONITOR-RECOVERY-REVIEW.md for exact evidence and trial bounds.

The largest blocker is still complete live writer coverage. Production order-confirm source retrieval remains unavailable and the reported order-backend repository remains inaccessible (404), rechecked read-only on 21 October. The owner-supplied backend is useful reference material but does not independently prove the deployed revision. Checkout currently persists order and item rows separately; legacy direct admin/customer paths and rejected browser attempts need explicit coverage or exclusion. See PRODUCTION-CAPTURE-REVIEW.md and CUSTOMER-RESPONSE-ADAPTER.md.

CUTOVER-BASELINE-REVIEW.md documents the new offline contract. A saved-state baseline is not reconstructed decision history, and its markers cannot prove capture completeness without an authoritative source barrier and all-writer integration. The private staging Postgres functions now support source seeding and export, proven under rollback. CUTOVER-HOSTED-REHEARSAL.md records the remaining concurrency blocker, unchanged Railway deployment, default-denied seed permissions and disabled fixtures. No production schema or runtime grant was changed. No source data was imported into production or relabelled as history.

The deployment sequence remains: complete source mapping and hosted concurrency rehearsal of the staging baseline producer; rehearse the complete lifecycle with matching source/build identity, monitoring and recovery; review the production capture diff; then observe representative quiet, steady and busy services. Many small delivery orders remain especially important validation cases. Automatic booking decisions and delivery grouping are later decisions after shadow evidence review.

Most remaining effort is integration and evidence coverage. There is no defensible completion date while the source-access, baseline-producer and writer-coverage dependencies remain open. Hypothetical plans never confirm actual cooking or driver activity.
