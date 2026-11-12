# Admin payments and tips — 12 November 2026

Status: implemented and component/staging transaction tested; NOT production ready.

## Implemented
- Final stored order total is authoritative. Bill paid in full by cash, card or bank transfer; optional tip with an independent method.
- Dedicated atomic payment writer, common kitchen/order locks, paid flag + payment + audit commit together; idempotent identical retries and conflicting request refusal.
- No completion, capacity, loyalty or notification side effects. Completed orders may receive payment details. Cancelled orders refuse capture.
- Previously paid orders without a payment row remain method unknown. Staff can add details, with previously_marked_paid retained. No inferred methods or historical bulk updates.
- Signed Cloudflare Access staff identity, existing allowlist, same-origin protection and private proxy credentials. Browser-supplied staffActor is overwritten at both proxy hops.
- Independent MASTER_WOK_PAYMENTS=enabled flag required in Cloudflare, Railway and Edge. Defaults disabled.
- Admin Mark paid opens the payment dialog only when enabled. Unknown save outcome preserves the original request and offers an identical retry.
- RLS enabled on both tables; no anon/authenticated/service_role table privileges. Direct authoritative SQL writer only.

## Evidence
- Core regression suite: 337 passed.
- Website/access/client suite: 43 passed.
- Backend route suite: 21 passed.
- Actual staging PostgreSQL writer: 14 scenarios passed including concurrent captures, identical/conflicting retry, stale total, invalid tip, missing actor, injected update failure with complete rollback, unknown legacy method and completed order annotation.
- Fixture cleanup verified: zero remaining payment-certification orders.
- Browser preview: £32 card bill + £3 cash tip recorded; status stayed Confirmed. This used mocked transport, not hosted end-to-end authentication.
- No production mutations or notification sends.

## Still required
1. Deploy branch code to isolated hosted staging, bind its new source digest to the staging candidate and enable the payment flag there only.
2. Exercise signed Cloudflare -> Railway -> Edge -> PostgreSQL path, feature-off behavior and uncertain-response retry in the actual Admin page.
3. Complete production rollout/rollback package. Order-row summaries are implemented; browser preview confirms a saved card bill/cash tip appears on the row without changing Confirmed status.
4. Explicit owner approval before production Supabase migration/runtime deployment. Do not reuse a certificate bound to an older source digest.

First version supports one full bill payment and one optional tip. Corrections, split payments, partial payments and refunds are not implemented; duplicate captures are refused rather than overwriting history. End-of-day reconciliation receipt follows payment rollout.

## Rollback
Disable payment flags to return to existing Mark paid behavior. Preserve payment and audit tables/rows; do not drop or backfill them. Do not change booking authority or remove service plans. Until all known older paid orders have method details, reconciliation must show method unknown separately.

## Hosted staging progress
- Railway staging gateway deployment aaf9c45f-a68d-45ba-9b27-e2dd2358dbce: SUCCESS, payment flag enabled, source pinned to backend payment branch commit 3f864aa830718b4fd0165b60c94c644915dc5fd7.
- Supabase staging master-wok-booking v59 ACTIVE, runtime digest 045da2c60703163228e028397c131eac22a9ae463e3fedad078e0dc4ce19595b, payment flag enabled; existing staging source-bound candidate updated.
- Actual hosted Edge requests: save HTTP 200 committed, identical retry HTTP 200 replayed without commit, batch summary HTTP 200 one result, invalid batch HTTP 400. Fixtures cleaned.
- Core 337 and website 43 tests rerun successfully after row summaries.
- Remaining integration blocker: Cloudflare Preview MASTER_WOK_PAYMENTS flag must be enabled by the owner, and the new branch Preview URL supplied. Railway OAuth hides existing proxy secret values, so direct authenticated gateway calls cannot be synthesized from current credentials. No production flags were changed.

## Full hosted browser acceptance — PASS
Preview https://19c16d6e.rungsthaikitchen.pages.dev/admin reported enabled=true. In the signed staff session, synthetic PAYMENT-TEST saved £32 card + £3 cash tip through Cloudflare -> Railway -> deployed booking Edge -> PostgreSQL. Order row showed both methods, refresh/reopening read the persisted payment without offering a duplicate entry form. Database verification: paid=true, status=confirmed, loyalty_settled=false, payment rows=1, audit rows=1, staff actor recorded. Synthetic order/payment/audit fixtures removed; remaining test orders=0. The earlier disabled Preview retained the existing confirmation prompt; it was dismissed without writing.

The prior Cloudflare integration blocker is resolved. Production remains unchanged. Remaining release work: exact source-bound production certificate, final deploy/rollback package and explicit production approval. No claim is made that a dropped response was injected into the hosted browser; server replay/concurrency and fault rollback are covered by the staging transaction tests.
