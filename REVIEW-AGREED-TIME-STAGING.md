# Agreed-time basket checkout — staging work, 11 November 2026

Owner approved a staff-only, customer-discussed exception to the usual maximum holding time on 11 November. This does not authorize production deployment or engine activation.

Admin records the exact agreed time, maximum holding minutes, reason and customer discussion. Verified Access identity becomes the audit actor; browser-supplied actors are replaced. A 256-bit bearer capability is returned to staff for private sharing, expires after 30 minutes, and only its SHA-256 digest is stored. Approval does not reserve capacity or promise successful checkout.

The return link restores the reviewed basket into the existing checkout. The customer supplies any missing details and acknowledges the stated holding limit. Prices, loyalty, delivery eligibility, service controls, kitchen equipment and current commitments are checked by the existing locked atomic writer. Changed basket/time/phone/address, expiry, missing acknowledgement, or a consumed/closed grant cannot authorize the exception. Booking, saved kitchen/driver plan and grant consumption share one transaction. Existing idempotent receipt replay remains before grant consumption checks. A grant cannot select another scheduler or bypass the release fence.

The persisted plan carries per-order exception metadata. Shared batches apply the most restrictive participating order's policy. Subsequent bookings retain existing exception work, but ordinary new orders retain their own normal holding limit. Planned food age is measured at the door for delivery. Delivery travel/reservation, equipment, closures and preparation deadlines remain enforced.

Feature gates: Railway and the Edge runtime both require MASTER_WOK_REVIEW_APPROVALS=enabled. Cloudflare reads the gateway capability; production remains disabled. Runtime source changes require fresh source-bound staging certification and later production review.

Current local checks: 315 core tests (including actual eleven-noodle exception, normal subsequent order, closure refusal, remapped saved identity, grant binding and transaction rollback); 38 website tests; 39 focused gateway tests; 22 active inline scripts parse. Hosted browser approval-to-checkout and concurrent-token consumption remain required before certification. No new real notification sends are authorized.

Prepared staging schema was applied to hvrqgufqjslvgiohgkvu/master_wok_rehearsal. RLS is enabled; anon, authenticated and service_role have no table read privileges. Production schema is unchanged. Edge candidate version 57 is active with source 42937fbe290b808dddeaa61868d3b7d164b1c3b8ee0716d2fa744d99059eaf1f. This is staging evidence, not production approval.

Outstanding operational detail: expired links require an explicit replacement workflow before this feature is production-ready. Do not silently reopen a resolved or closed review. Admin must not mark an approved enquiry resolved without the atomic checkout.
