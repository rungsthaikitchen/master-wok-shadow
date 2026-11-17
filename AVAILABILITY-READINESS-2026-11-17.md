# Availability release review — 17 November

## Result

Staging scheduling and order lifecycle pass. Production is not yet ready to activate: current-source production binding/certification and provider notification verification remain open. Production is still LEGACY revision 10. The newly built production package is deliberately DRAFT, binds the tested runtime digest, and refuses bookings without opening a database connection. Older production certification is not transferred to these changes.

## Verified

- Owner tested the £104.50 basket against the seeded service, including different add-to-basket orders, collection/delivery switching and reopening checkout. The three collection kitchen conflicts and eleven delivery conflicts now have definite unavailable labels; capacity/food-holding limits were retained.
- Owner tested the £29 basket on an empty trading date: all collection and delivery times appeared. Initial search took 10–15 seconds; repeat checks took under 4–5 seconds.
- RTK-213 was submitted from the preview as delivery, 25 November 18:30, and accepted in staging Admin. Saved total was £29 food + £3 delivery − £5 loyalty = £27. Its kitchen schedule and one driver arrival reservation were verified.
- The order was then cancelled through the official lifecycle. No kitchen jobs or driver trips remain for that date. Booking receipt and history remain. Its three queued test notifications were skipped; no send attempts occurred.
- Current guarded rollback rehearsal passed all ten cases against temporary copies, preserving records and making no permanent mutations. It refuses unsafe drain/driver/hold/lifecycle states, stale revisions and permits a completed-service restore.
- 414 backend/package tests and 92 website tests pass. Website branch is ahead of current production, with no divergent production commits. Existing minimum-spice changes remain in its base.

## Remaining work

1. Verify customer SMS/email and kitchen/staff notification delivery via the intended provider path. Suppressed staging outbox events are not delivery evidence. Any actual test send must be explicitly authorized with recipient and content.
2. Complete source-bound production database/configuration verification and reconcile current evidence before changing the new certificate from DRAFT. The public-schema deployment must accept normal customer emails; synthetic-email restrictions are candidate-staging-only.
3. Present the concrete pre-service cutover and guarded rollback for approval. Do not activate or merge/deploy production implicitly from this review.

## Rollback order

Pause new orders while Master Wok remains active; finish or cancel its outstanding orders and wait for driver and extended-hold work to finish. Enter DRAINING only for the final locked, revision-checked guard and Legacy restore. Preserve order history, plans and receipts. DRAINING is not the mode for completing the service. Do not promise a safe instant switch while outstanding authoritative work remains.

Build the disabled production candidate with `node staging-tests/build-atomic-checkout-edge.cjs --release-availability`. Its certificate is `master-wok-release-candidate.availability.production.json`; all certification checks remain PENDING. The staging runtime was not modified by the package review.
