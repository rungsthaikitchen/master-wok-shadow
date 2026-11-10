# Four-ring release review — 10 November 2026

Status: PREPARED FOR REVIEW, NOT PRODUCTION APPROVAL.

## Exact components

- Runtime source: `a1230b05e03b5cdef91e923fb4c1c1feeef307eea1bc687cbebd012e5b9ace15`.
- Proposed production release: `master-wok-four-ring-2026-11-10`.
- Proposed certificate: `master-wok-release-candidate.four-ring.production.json`,
  DRAFT, all checks PENDING. Build with
  `node staging-tests/build-atomic-checkout-edge.cjs --release-four-ring`.
- Private staging certificate remains CANDIDATE_FOR_STAGING, fixture-only.
- Website preview: branch `feature/basket-review-staging-2026-11-07`,
  commit `9dbba88aae9153dc2a47ba6551cc2c7159ef33c4`, PR #68.
- Railway staging gateway: deployment `424c28ce-0727-43db-9a3f-3d4f71c3335b`,
  backend commit `2042d266bf7c81058428ff996205d2380f4694ec`.

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
| Regression | Full core suite in UTC and Europe/London; website 36 and backend 46 | Record current run results in BASKET-REVIEW-STAGING.md |
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
