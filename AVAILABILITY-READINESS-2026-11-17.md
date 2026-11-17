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

1. The one-off SMS provider/handset test has passed. Verify customer email, staff push and the intended order-outbox delivery flow. Suppressed staging outbox events are not delivery evidence. Any further actual test send must be explicitly authorized with recipient and content.
2. Complete source-bound production database/configuration verification and reconcile current evidence before changing the new certificate from DRAFT. The public-schema deployment must accept normal customer emails; synthetic-email restrictions are candidate-staging-only.
3. Present the concrete pre-service cutover and guarded rollback for approval. Do not activate or merge/deploy production implicitly from this review.

## Rollback order

Pause new orders while Master Wok remains active; finish or cancel its outstanding orders and wait for driver and extended-hold work to finish. Enter DRAINING only for the final locked, revision-checked guard and Legacy restore. Preserve order history, plans and receipts. DRAINING is not the mode for completing the service. Do not promise a safe instant switch while outstanding authoritative work remains.

Build the disabled production candidate with `node staging-tests/build-atomic-checkout-edge.cjs --release-availability`. Its certificate is `master-wok-release-candidate.availability.production.json`; all certification checks remain PENDING. The staging runtime was not modified by the package review.

## SMS provider receipt — 17 November

Owner authorized one clearly labelled staging SMS to his number ending 9669 and confirmed handset receipt. The probe consumed no outbox events and created no booking. Its transport response was not observed, so it was not resent. The send deployment was replaced; its disabled flag prevented another send. Probe flag and recipient were cleared, background worker disabled, original start command restored in configuration, restart NEVER and no staged changes remain. Provider credentials were not copied or changed. This closes the SMS provider-access/handset check only; email, staff push and the intended order-outbox delivery path still need verification. See STAGING-SMS-RECEIPT-2026-11-17.json.

## Notification follow-up

The owner confirmed receipt of SMS, email and Pushover. Brevo accepted the final email with HTTP 201 after IP authorization. All standalone probes are disabled.

RTK-214 was created through current staging checkout, then processed by the exact current backend worker and renderer through an isolated HTTP transport to the unchanged current dispatcher implementation. Fixture providers accepted one customer email and one staff push. Each delivery has one attempt, the event finished sent, and a second claim returned empty. Replaying checkout returned the same order, with one order-created event. No real provider calls occurred in this queue rehearsal. The order was officially cancelled, its cancellation notification skipped, and the isolated dispatcher replaced by an inactive JWT-protected 410 handler. Old staging events were untouched. See STAGING-NOTIFICATION-FLOW-2026-11-17.json.

This is component and durable-flow evidence, not proof that the intended production worker is deployed and bound correctly. Its command must run the real worker rather than tests/run_release_notification_loop_staging.py (fixture-only), with the matching booking URL, notification secret and time-link base. Production mode was rechecked as LEGACY revision 10. Production scheduling tables have RLS and the eight write-fence triggers remain enabled. The current production certificate/configuration binding remains open.
