# Production ordering release — 14 November 2026

Owner approved the production rollout after accepting the £104.50 basket, percentage progress and the delivery arrival-deadline replay.

Runtime source: 0ba1e97de2efec9eb1a1f9b4c099330b26446c99f3cb1fb0d24d8293cd84c1e4, matching staged runtime 74. Production baseline: runtime 16, source dc376ff1e3f49b7a60deb1196c405ab85386c521e8e09b6d879759d97e38994a.

Compared all 52 imported non-certificate modules against the running production bundle. Only five changed: the driver planner, delivery-capacity adapter, fryer attribution, shared-ring allocator and availability hint response. Atomic checkout, idempotency, payments, loyalty, amendments, notification dispatch and persistence are byte-identical. No SQL migration or booking-mode change is required. Current durable control is MASTER_WOK, approved release master-wok-four-ring-2026-11-10, revision 8.

Validation: 375 core and 70 website tests pass. Staged £104.50 exact split-line basket passed three consecutive whole-day browser searches, 44 verified normal-service choices each time. Worker compute limits remain possible; six-hint batches plus one read-only transient retry handle the observed failures. No partial list is returned after a failed batch. Last-night replay confirms the new deadline refuses RTK-1635 at 19:45/19:50 and can arrive on time at 19:55/20:00. Existing reservations are preserved.

The website release integrates the script extraction and availability changes while retaining live checkout type selection and same-day review cutoff fixes. Reconstructing the inline scripts and comparing with current production found only the reviewed availability/progress changes. Menu, prices, allergens, layout and Admin/payment flows are retained.

Pre-service read-only inventory found no active/future orders and no plans dated 14 November onward. Repeat the inventory under the authoritative writer lock immediately before runtime deployment. Preserve the launch-control revision; this is a compatible runtime update, not a legacy reactivation.

Rollback: retain the previous deployed Edge bundle and production website commit 572d61ad84a0716239bc167e4e935f2ed0ae824e. Restore prior application code without deleting orders, receipts, plans or notifications. There is no schema or data rollback. Old readers accept the unchanged plan shape and on-time trips; the old availability limitations return if its code is restored. Any new orders remain authoritative and must not be discarded. Do not switch to LEGACY as part of this application rollback.

Deployment completed: production Edge runtime 17, source 0ba1e97de2efec9eb1a1f9b4c099330b26446c99f3cb1fb0d24d8293cd84c1e4, certified with no staging configuration overrides. Core PR12 merged as 0b8ad3012aa47c7723fbd6adcfa626d5c1fa5032. Website PR84 merged as 697f8c8f0b3c42cb79706fe5cbae80a80b55c3bc; Cloudflare Pages reports successful deployment. PR80/81 are closed as included in the integrated release.

The live https://rungsthaikitchen.co.uk/ browser check recreated the exact six-line £104.50 basket. Opening feedback appeared immediately; selecting 14 November returned 49 selectable normal-service times, zero unverified, and 18:30 was successfully selected. No customer details entered or order submitted.

Before/after read-only inventories: 1,519 orders, 5,999 items, 21 booking receipts, 47 outbox events, zero current/future service plans. Booking mode remains MASTER_WOK revision 8. No data or notification write was introduced by the smoke check. Both repositories retain rollback/pre-ordering-release-2026-11-14; rebuilding the backend rollback branch reproduces the exact previous source hash.
