# Admin payments and tips — release review, 12 November 2026

Status: staging acceptance passed; production approval pending. Production unchanged.

## Behaviour
Record a full bill by cash, card or bank transfer, and an optional tip with its own method. The stored final order total is authoritative. Payment, append-only audit event and paid flag commit atomically under the existing writer/order locks. Identical retries replay; conflicting retries and duplicate captures refuse. Completion, capacity plans, loyalty and notifications are unchanged.

Completed unpaid orders may be paid. Previously paid orders without payment details show method unknown; staff may add details, retaining previously_marked_paid provenance. No historical methods are inferred or backfilled. Cancelled orders refuse capture. The first release does not support corrections, partial/split payments or refunds.

Admin rows show paid/unpaid, bill method and tip details. Background refresh does not submit payments. An uncertain response retains the request key and offers an identical retry.

## Security
Independent MASTER_WOK_PAYMENTS flag at Cloudflare, Railway and Edge; defaults disabled. Signed Cloudflare Access staff identity and allowlist, origin check and existing private proxy credentials. Browser actor is overwritten at both proxy hops. Both new tables have RLS enabled and no anon/authenticated/service_role table privileges. Direct authoritative SQL writer only.

## Evidence
- 337 core, 43 website/access/client and 21 backend route tests passed.
- 14 actual staging PostgreSQL scenarios passed, including concurrent captures, identical/conflicting retry, stale amount, invalid tip, missing actor, injected failure with complete rollback, unknown historical method and completed-order annotation.
- Railway staging deployment aaf9c45f-a68d-45ba-9b27-e2dd2358dbce: SUCCESS, backend 3f864aa830718b4fd0165b60c94c644915dc5fd7.
- Supabase staging master-wok-booking v59 ACTIVE, digest 045da2c60703163228e028397c131eac22a9ae463e3fedad078e0dc4ce19595b.
- Hosted Edge save/retry/list/invalid-list checks passed. Identical retry returned replayed without another commit.
- Full signed browser path passed at https://19c16d6e.rungsthaikitchen.pages.dev/admin: £32 card bill + £3 cash tip. Row and reopened dialog preserved details after refresh. Database: status confirmed, paid true, loyalty_settled false, one payment, one audit entry, staff actor recorded.
- Earlier flag-off Preview retained old Mark paid confirmation; prompt dismissed without writing.
- Synthetic fixtures removed and zero remaining test orders verified. No production mutations or test notification sends.
- A dropped response was not injected into the hosted browser; server replay/concurrency and fault rollback are tested separately.

## Production package
ADMIN-PAYMENTS-PRODUCTION-PACKAGE.json binds exact migration/source digests, commits, deployment sequence and rollback targets. master-wok-release-candidate.payments.production.json remains DRAFT pending explicit owner approval. Its bundle digest matches the staging-tested runtime. Existing kitchen release ID and booking authority remain unchanged.

The migration adds two tables and their index/RLS/grants only, with no order rewrites or backfill. Deploy code with payment flags disabled; check backend SUCCESS and Brevo authorisation before activation. Owner must set production Supabase and Cloudflare flags because those secret/configuration APIs are unavailable here.

## Rollback
Disable payment flags and redeploy Cloudflare to restore existing Mark paid UI. Preserve all payment/audit tables and rows, orders, service plans, booking receipts, outbox and loyalty history. Edge v8 and previous backend/website commits are recorded in the package. Do not switch booking mode to LEGACY or drop tables for a payment rollback. End-of-day receipt follows payment rollout.
