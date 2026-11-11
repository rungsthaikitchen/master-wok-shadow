# Agreed-time basket checkout — staging work, 11 November 2026

Owner approved a staff-only, customer-discussed exception to the usual maximum holding time on 11 November. This does not authorize production deployment or engine activation.

Admin records the exact agreed time, maximum holding minutes, reason and customer discussion. Verified Access identity becomes the audit actor; browser-supplied actors are replaced. A 256-bit bearer capability is returned to staff for private sharing, expires after 30 minutes, and only its SHA-256 digest is stored. Approval does not reserve capacity or promise successful checkout.

The return link restores the reviewed basket into the existing checkout. The customer supplies any missing details and acknowledges the stated holding limit. Prices, loyalty, delivery eligibility, service controls, kitchen equipment and current commitments are checked by the existing locked atomic writer. Changed basket/time/phone/address, expiry, missing acknowledgement, or a consumed/closed grant cannot authorize the exception. Booking, saved kitchen/driver plan and grant consumption share one transaction. Existing idempotent receipt replay remains before grant consumption checks. A grant cannot select another scheduler or bypass the release fence.

The persisted plan carries per-order exception metadata. Shared batches apply the most restrictive participating order's policy. Subsequent bookings retain existing exception work, but ordinary new orders retain their own normal holding limit. Planned food age is measured at the door for delivery. Delivery travel/reservation, equipment, closures and preparation deadlines remain enforced.

Feature gates: Railway and the Edge runtime both require MASTER_WOK_REVIEW_APPROVALS=enabled. Cloudflare reads the gateway capability; production remains disabled. Runtime source changes require fresh source-bound staging certification and later production review.

Current local checks: 315 core tests (including actual eleven-noodle exception, normal subsequent order, closure refusal, remapped saved identity, grant binding and transaction rollback); 39 website tests; 39 focused gateway tests; 22 active inline scripts parse. Hosted browser collection approval-to-checkout passed as RTK-190 (then normal Admin Accept confirmed it), and renewed link checkout passed as RTK-191. Hosted distinct-key concurrent consumption and holding-exception delivery checkout remain before certification. No new real notification sends are authorized.

Prepared staging schema was applied to hvrqgufqjslvgiohgkvu/master_wok_rehearsal. RLS is enabled; anon, authenticated and service_role have no table read privileges. Production schema is unchanged. Edge candidate version 58 is active with source 56a47189fd294172aac671b77a65dff12ef78aa5ceca46416b40f4e0e396c80d. This is staging evidence, not production approval.

Staff can explicitly replace an unconsumed approved link after a fresh discussion. Replacement rotates the capability, invalidates the earlier link, and preserves prior grant details in audit_history. Resolved/closed/consumed grants cannot be renewed. Hosted replacement verification passed: prior token rejected, original audit retained, replacement checkout RTK-191 produced one receipt and atomically resolved its review.


11 November follow-up: hosted holding-exception delivery (RTK-192), normal following order (RTK-193), distinct-key grant race (RTK-194), identical-key retry race (RTK-195), revocation/closed-link checks and database reconciliation all pass. The current-source 12-basket whole service and opening capacity tests also pass with 13 receipts. See STAGING-REVIEW-DELIVERY-CONCURRENCY-RESULT.json and STAGING-FOUR-RING-CURRENT-WHOLE-SERVICE-RESULT.json. Expanded rollback TEMP rehearsal and refreshed preview sign-in remain gates; no production activation is approved.
