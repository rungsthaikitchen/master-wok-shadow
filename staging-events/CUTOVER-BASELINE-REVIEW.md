# Cutover baseline for prospective comparison

21 October 2026. Offline/synthetic staging review only. No production writes, deployments, source grants or scheduling/checkout changes.

## Why it is needed

The empty-start replay contract cannot describe starting observation with existing reservations. Recreating those saved orders as historical creation/acceptance events would invent their chronology. A cutover baseline instead records the saved commitments present at one explicit boundary and allows comparison of subsequent recorded decisions only.

The batch retains the same three root fields. For this mode coverage.basis is CUTOVER_BASELINE_AND_EVENT_LOG and initialState is SAVED_STATE_AT_CUTOVER. complete=true asserts completeness FROM the cutover, not completeness of the earlier service history. The first sequence must be CUTOVER_BASELINE with basis CURRENT_SAVED_STATE_AT_CUTOVER, a server at timestamp, commitments, and unreservedOrderIds. It never contributes a decision observation.

Each held commitment has the existing allowlisted order payload, commitment PROPOSED or CONFIRMED, and proposalEventId. Proposed reservations require a unique opaque source-mapped current reservation revision; confirmed rows require null. Missing or ambiguous revisions are rejected, not fabricated. The private synthetic backend also has pending request holds: their create-event revision identifies the hold but is not a communicated offer. The copied lifecycle status still refuses customer acceptance until an actual offer exists. Known orders with no capacity hold may be listed by pseudonymous ID so a later terminal status can be recorded without creating a reservation.

The baseline seeds the reducer's held/known/proposal state at cutover. Subsequent acceptance confirms the same hold; a new proposal replaces it immediately, and rejection/releases remove it. Cross-date pair validation can bind an outgoing order to a baseline hold without creating an earlier booking event. Delivery estimates are neither invented nor retimestamped; missing/stale evidence still leaves affected comparisons UNVERIFIED.

The result explicitly carries coverageBasis, baselineAt, baselineCommitments and historicalDecisionCoverage=false. Overall verified remains false. A baseline-only batch has zero comparisons regardless of how many commitments it contains. Existing batches with NO_PRIOR_SERVICE_COMMITMENTS retain their original contract and outputs.

## Time and evidence limits

All later events must be strictly after the cutover at the current adapter's millisecond precision. Equal-clock or unrepresentable sub-millisecond boundary ordering is refused. A future source needs an explicit transaction/sequence barrier; never add fictional milliseconds to make an event pass. The complete post-cutover log still needs source-side proof of writer coverage and a consistent watermark.

The baseline supplies explicit effective targets. This module does not choose proposed/confirmed/preferred precedence from ambiguous legacy production rows. That mapping needs the reviewed source adapter and the agreed offer-reservation rule. Partial baskets, extra private fields, duplicate IDs, duplicate/unknown offer revisions and inconsistent date/coverage markers are refused before comparison.

At most 500 held commitments and 1,000 total held/unreserved known IDs fit this bounded contract. The existing five-megabyte/1,000-event limits apply. Baseline commitments are not observations of cooking already in progress; the kitchen plans remain hypothetical. A target that cannot be planned from the cutover does not establish that the food was already cooked.

## Durable evidence and recovery

The baseline is the first immutable event, so existing batch hashes and every subsequent source-prefix hash include its complete content. Replacing it after intake is a captured-history conflict. The single-stream journal persists explicit cutover provenance on each new comparison and refuses worker results omitting it. Restore checks bind that provenance to the batch. Paired results similarly require matching baseline provenance; whole-bundle hashes include both baselines.

Local tests demonstrate durable intake, future-only observations, rewrite refusal, failed-result rollback, reopened snapshot recovery, and a baseline-held order moving across two service days. The fixture contains invented orders and no customer data.

The private staging PostgreSQL producer/export candidate now supports the baseline under rollback-tested lifecycle checks; generic record ingress still refuses arbitrary baseline events. No producer is installed in production. See CUTOVER-HOSTED-REHEARSAL.md for exact current scope and the outstanding real-concurrency blocker. No production saved-state export is relabelled complete and no source hook is installed. The source-side candidate atomically establishes the baseline, seeds the matching reservation projection and retires the old private stream; the hosted rollback/lifecycle checks pass. Multi-session hosted verification and proof of all active production writers remain required before prospective completeness can be claimed.

## Access dependencies checked again

Read-only source checks on 21 October still returned UNAVAILABLE for production order-confirm and 404 for rungsthaikitchen/order-backend. No permissions were expanded and no production endpoint action was executed. The owner-supplied backend remains reference evidence, while deployed-source matching and exact legacy customer-response coverage remain unresolved. These block a trustworthy complete live-handler patch, but did not block this offline baseline work.

Validation: 191 core Node tests pass in Europe/London and UTC; all 19 focused staging Node tests pass in both timezones; all 82 Python event tests pass. No deployment or database mutation was performed for this change.
