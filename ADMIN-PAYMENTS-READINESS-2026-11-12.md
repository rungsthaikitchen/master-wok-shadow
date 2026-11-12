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
3. Add payment summary to the order row (the dialog currently reads saved details), verify refresh behavior and production rollout/rollback package.
4. Explicit owner approval before production Supabase migration/runtime deployment. Do not reuse a certificate bound to an older source digest.

First version supports one full bill payment and one optional tip. Corrections, split payments, partial payments and refunds are not implemented; duplicate captures are refused rather than overwriting history. End-of-day reconciliation receipt follows payment rollout.

## Rollback
Disable payment flags to return to existing Mark paid behavior. Preserve payment and audit tables/rows; do not drop or backfill them. Do not change booking authority or remove service plans. Until all known older paid orders have method details, reconciliation must show method unknown separately.
