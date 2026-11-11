# Four-ring release review — 11 November 2026

Status: PREPARED FOR REVIEW, NOT PRODUCTION APPROVAL.

## Exact components

- Runtime source: `56a47189fd294172aac671b77a65dff12ef78aa5ceca46416b40f4e0e396c80d`.
- Proposed production release: `master-wok-four-ring-2026-11-10`.
- Proposed certificate: `master-wok-release-candidate.four-ring.production.json`,
  DRAFT, all checks PENDING. Build with
  `node staging-tests/build-atomic-checkout-edge.cjs --release-four-ring`.
- Private staging certificate remains CANDIDATE_FOR_STAGING, fixture-only.
- Website preview: branch `feature/basket-review-staging-2026-11-07`,
  commit `8c550c70686cf03e31217048480afd93e1f64f50`, draft PR #69.
- Railway staging gateway: deployment `88b782b1-a728-4b73-b201-23657198711b`,
  backend commit `bc6bb47aaf68c6c9734ebf15c5713d70f87ebcba`, draft backend PR #3.

The immutable physical model identity is still
`combined-kitchen-four-ring-staging-v1`; its historical name does not grant or
restrict booking authority. Certification binds the model, confirmed
FOUR_RING_ONE_PORTION_V1 configuration, source, schema, project, release and every
required check. DRAFT cannot initialize a writer. Candidate remains private
staging only. Production needs CERTIFIED_FOR_PRODUCTION plus the operator's
matching durable launch approval; request flags cannot certify or approve it.

The earlier `master-wok-release-candidate.json` is a historical single-wok delivery
DRAFT, not this release. Its PASS entries must not be inherited. The older
PRODUCTION-RELEASE-PACKAGE.json approval refers to the November 4 release only.

## Completed evidence

| Area | Evidence | Limit |
|---|---|---|
| Hardware and baskets | 4 rings, 2 large/2 small woks, 5 pans; one main portion per vessel; independent timeline/coverage validation | Planned cooking is not proof of actual cooking |
| Customer checkout | £50 RTK-186 and £100 RTK-187 actual preview delivery submissions, one booking receipt each | Synthetic contacts and public destination; no production bookings |
| Lifecycle | Admin Accept, £50 Suggest18:35, customer acceptance and replay, refreshed Admin | No new real notification receipt claimed |
| Delivery | Saved loading/departure/door/return times; read-only recommendation, explicit combine/split, stale-revision refusal | Most combined-trip evidence is hosted API rather than actual browser controls |
| Availability | Occupied-day £100 lookup: 49 hints, 46 available, 10.77s; hints never approve | Four £150 pressure examples also completed hosted scans |
| Regression | Full 310 core tests in UTC and Europe/London; website 36 and backend 46 | Record current run results in BASKET-REVIEW-STAGING.md |
| Earlier rollback | Gateway drained/restored with receipts and plans preserved | New Legacy checkout and complete delivery rollback not certified |

Detailed raw records: STAGING-FOUR-RING-BROWSER-DELIVERY-RESULT.json,
STAGING-FOUR-RING-OCCUPIED-DAY-HINTS-RESULT.json,
STAGING-FOUR-RING-COMBINED-DELIVERY-RESULT.json,
STAGING-ROLLBACK-GATEWAY-RESULT.json.

## Remaining before production approval

1. Bind the final source snapshot and reconcile every certificate check with
   concrete evidence. The prepared bootstrap now supports certification of the
   actual four-ring engine; this is not certification itself.
2. Finish the complete delivery rollback rehearsal. Guard must refuse outstanding
   driver trips/orders; retained receipts, notification ownership, loyalty and
   capacity commitments must survive the compatible Legacy restoration.
3. Reconcile notification contracts/worker source against prior received provider
   evidence. Any new real SMS/email/Pushover test needs explicit bounded approval;
   do not dispatch the synthetic browser fixtures to external providers.
4. Hosted £150 full-day scans now complete without CPU crashes; mixed and
   starter/curry examples have available times, while stir-fry/noodle examples
   remain unverified. Two £150 atomic collections and exact-key replays also
   passed. Confirm the enquiry route remains the escape path for unverified
   baskets; do not reinterpret a bounded search as proof of physical impossibility.
5. Prepare the revision-checked pre-service cutover and exact rollback deployment
   targets from a fresh read. The cutover guard must run under the writer lock.
   Keep Legacy authoritative until the owner approves that concrete package.

## Preserved business rules

Opening/production windows and blackouts remain separate; Busy/Very Busy add lead
time without extra equipment. Driver promises are front-door arrival. Preferred
finished-food holding is 10 minutes, maximum 20; no unknown basket can authorize a
booking. Microwave dumplings use 4/6/8 minutes for 1/2/3 portions, rice reheating
rounds 2m30s to 3 minutes. Coconut rice finishes in a curry pan. No additional chef
interaction or dashboard is introduced.

## Hosted £150 repair evidence

The preferred ten-minute holding attempt has a small search budget before trying
the agreed twenty-minute maximum with the full booking budget. Fryer-dependent
baskets first use the established dependency order; constrained-vessel ordering
remains available as the bounded alternative. Read-only suggestions and review
diagnostics have a separate finite budget; exhausted searches remain unverified.
Checkout retains the full twenty-minute assessment under the booking lock.

All four pressure examples returned 49 hosted hints in 9.4–10.5 seconds. Mixed
had 47 available, starter/curry 49, stir-fry and noodle zero verified slots. The
mixed basket committed as RTK-188 at 18:30 and starter/curry as RTK-189 at 20:15
on 28 November, £150 each. Same-key retries returned the original orders with
committed=false. Server plan revision 2 preserves both baskets, maximum main
holding 20 minutes, and one portion per hot vessel; cold salad batching remains
separate. No provider sends or production mutations. See the LARGE-HOSTED result
files; these are actual server transactions, not an additional browser checkout.

## Customer enquiry completed / remaining manual guard rehearsal

Actual preview enquiry, receipt, exact Admin basket, contacted and closed states
passed with zero orders created. Subsequent v56 normal unavailable-slot response
also passed after adding a necessary per-promise workload bound: distant orders
cannot enlarge a noodle basket's own holding window. Full 310-test suites pass
in UTC and UK time. Production remains DRAFT and unchanged.

Owner SQL Editor execution completed the TEMP-copy rollback guard rehearsal.
All seven cases PASS; the guard SHA matches the committed release SQL. Unsafe
switches and stale revision were refused, and the completed-service TEMP switch
preserved orders/plans/receipts. Live staging remained MASTER_WOK revision41;
permanentMutations=0. Evidence: STAGING-DELIVERY-ROLLBACK-GUARD-RESULT.json.
This is database guard/preservation evidence, not a new Legacy customer checkout
or a Cloudflare/Railway deployment rollback. Existing hosted gateway restoration
evidence remains separate and qualified.

Read-only production preflight: LEGACY revision4, no current/future orders. Thirteen
historical Legacy proposals still have response tokens; all are before Nov4 and
match the already-approved historical retirement scope. They are not new bookings.
Retire them only inside the final guarded production cutover transaction, preserving
all history/pricing/status fields. No production mutation occurred in this check.

## Compatibility deployment proposed, not authorized

Next production step is the exact website/backend pair in
PRODUCTION-FOUR-RING-COMPATIBILITY-PREPARATION.json, with Legacy authoritative,
reviews disabled, Supabase and notification worker unchanged. This stages a tested
compatible baseline before any separate engine activation. Approval is required
before merging production-targeted PRs or applying Railway changes.

Production main advanced again during review to58dfff3 (canonical peanuts spelling).
Candidate now includes that parent and all current main changes. The temporary
singular-peanut alias adjustment was removed as unnecessary; the behavioural
warning test remains. Website candidate1b917b7 passes37 tests.


## 11 November: reviewed basket acceptance extension

Owner approved explicit, customer-discussed per-request holding exceptions. Collection review -> scoped approval -> saved customer checkout -> one booked order -> normal Admin Accept passed as RTK-190. Link replacement, audit preservation, old-link refusal and customer acknowledgement passed as RTK-191. See STAGING-REVIEW-AGREED-CHECKOUT-RESULT.json and REVIEW-AGREED-TIME-STAGING.md. Current candidate is Edge v58/source 56a47189fd294172aac671b77a65dff12ef78aa5ceca46416b40f4e0e396c80d. Production remains Legacy and approval gates are off. The production certificate remains DRAFT/PENDING; historical source-bound evidence is not silently upgraded. Delivery exception and competing distinct-key grant consumption still require hosted verification.


## Current source-bound certification evidence — 11 November

- Deployed v58 (digest above): reviewed delivery RTK-192 accepted and confirmed; actual door food age 54 minutes under an explicit synthetic 60-minute allowance. Ordinary following order RTK-193 retained the normal rule (actual main hold zero).
- Distinct-key requests competing for one grant produced RTK-194 once (200/409). Concurrent identical-key retry produced RTK-195 once (one commit, one replay). SQL confirms one receipt per order, one consumed grant per reviewed order, zero grants for the ordinary order, and zero provider attempts. New negative tests refuse changed time, basket, address, missing acknowledgement, consumed/replaced/closed capabilities.
- Current deployed whole service: twelve mixed baskets plus opening-time capacity test; 27 checks pass. SQL confirms thirteen orders, 37 item rows, thirteen receipts, four-ring maximum, zero vessel-reset violations, maximum ordinary main hold twelve minutes, normal service restored, blackout deactivated, revision41 unchanged, zero provider attempts.
- Expanded rollback guard additionally refuses retained extended-hold collection work and any unfinalized Master Wok order. Read-only probes for active versus elapsed work and pending versus finalized lifecycle pass. Full expanded TEMP-copy guard/preservation rehearsal remains pending because the SQL tool confirmation expired. Use staging-tests/rehearse-delivery-rollback.sql in STAGING only; all copies are temporary and the script ends ROLLBACK.
- Correct rollback sequence: pause new orders while still in MASTER_WOK, finish/cancel existing Master Wok orders and driver/extended-hold work, then enter DRAINING only for the final locked revision-checked restore. DRAINING also fences lifecycle writes; do not use it as the mode for finishing a service.
- Preview browser reauthentication is required for the final same-page return-link check. Production currently remains Legacy4, with zero future active or unfinished Master Wok orders. Review tables/configuration are not installed in production. Production schema/config/runtime rollout still needs explicit approval after certification; it is not covered by the earlier compatibility deployment approval.

Evidence: STAGING-REVIEW-DELIVERY-CONCURRENCY-RESULT.json, its SQL result, STAGING-FOUR-RING-CURRENT-WHOLE-SERVICE-RESULT.json and its SQL/physical results. Historical evidence below is not silently attributed to a new source digest. The production certificate stays DRAFT/PENDING until final reconciliation.


11 November owner result: expanded guard rehearsal PASS, all ten cases, exact guard digest79ae0a3d62defb89e23d759c75777b9852754a4fad9c66d56752cfb336a592af. Unsafe delivery/hold/lifecycle switches and stale revision refused; safe TEMP restore preserved records. Live staging remained MASTER_WOK41, permanentMutations0. The earlier pending SQL rehearsal note is superseded by STAGING-EXPANDED-ROLLBACK-GUARD-RESULT.json. Final preview sign-in/browser return check and separately approved production rollout remain.
