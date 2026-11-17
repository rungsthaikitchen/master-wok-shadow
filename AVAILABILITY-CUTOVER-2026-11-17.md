# Availability cutover proposal

Status: reviewed for controlled installation; production activation is not authorized by this document. Current production is LEGACY revision 10, booking Edge v21, approved infrastructure release master-wok-four-ring-2026-11-10. Candidate source is 1c37c69c0b3542a4a21d1e301eade749da01d3500c9f2ef5eea1a7fef67c2d80; intended release is master-wok-availability-2026-11-17. The candidate certificate remains DRAFT pending the coordinated installation gate.

## Evidence

- 414 current backend/package tests pass.
- Current staging Edge v85 passed 27 hosted service checks, two-request capacity concurrency, and independent saved-plan physical, driver and food-age validation.
- All 14 rehearsal fixtures are cancelled, their capacity removed and notifications skipped without send attempts.
- Production database contract, RLS, write fences and existing notification worker are reviewed in PRODUCTION-BINDING-REVIEW-2026-11-17.json.
- Real SMS/email/Pushover receipts were confirmed separately from the fixture-provider durable-queue rehearsal. No new live production message was used to certify the new transport.
- Existing current-source ten-case TEMP-copy rollback evidence remains applicable; the runtime source was not modified in this follow-up.

## Coordinated installation after approval

1. Re-read production mode/revision, current Edge source, website main/PR heads and separately developed customer-review work. Stop on drift or any active work requiring a different cutover. Preserve the existing runtime/configuration and website deployment for restore.
2. Pause new ordering through existing service controls while production remains LEGACY. Confirm there are no in-flight unknown checkouts and record the prior service state. Do not enter DRAINING to run ordinary lifecycle work.
3. Reconcile the production certificate checks to the exact source-bound evidence and its stated qualifications. Coordinate MASTER_WOK_RELEASE_ID=master-wok-availability-2026-11-17 with the certified candidate function installation. Do not change this setting early: the existing function requires its existing release identity. The current connector cannot set Supabase Edge secrets, so this configuration step needs the dashboard or an authenticated management/CLI path during the pause. Do not reuse the older approval identity to bypass the setting.
4. Verify the installed source/certificate identity, normal production customer-email acceptance, authenticated mode read, Legacy-mode writer refusal, notification worker polling and gateway routing. Preserve current payment/amendment functionality. Keep mode LEGACY throughout this verification; restore the previous Edge and release setting if installation verification fails.
5. Prepare the website merge/deployment from the reviewed availability branch while preserving latest production/customer-warning changes. Recheck that the release changes do not overwrite unrelated work.
6. Acquire the authoritative booking lock and activate only with the expected live revision and the explicitly approved new release identity. Require exactly one control-row change. Do not activate if any prerequisite failed or drifted.
7. Check a controlled owner order through checkout, Admin acceptance and notifications; retain the same checkout key for uncertain results. Verify one order/receipt, correct totals and capacity, then cancel/clear its reservations through the official lifecycle. Restore the agreed service state only after successful checks.

## Restore

Before activation, restore the previous Edge and release setting while paused and still LEGACY. After activation, pause new orders while Master Wok stays active; finish or cancel outstanding Master Wok orders and driver/extended-hold work. Only then enter DRAINING for the final locked revision-checked restore guard. Preserve all orders, plans and receipts. There is no promised instant rollback with outstanding work.

Cold initial availability searches may still take 10–15 seconds; repeat checks were reported around 4–5 seconds. Source review does not remove this known limitation.
