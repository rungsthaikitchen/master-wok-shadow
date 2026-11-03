# Master Wok release deployment — review only

Production remains LEGACY. The production certificate is DRAFT, and the built
transport refuses bookings without connecting to PostgreSQL. No production DDL,
Edge deployment, Pages deployment or Railway changes are authorized by this file.

## Artifact and authority

Build with `node staging-tests/build-atomic-checkout-edge.cjs --release`. Stdout
is the deployable Supabase Edge source; stderr identifies the runtime source SHA.
The hash binds the entrypoint, complete imported implementation, model and price
catalogue. The certificate is excluded from the hash to avoid a circular digest.
It must separately name that exact source SHA, release, project, schema and model,
and require every release check to PASS. Requests cannot supply a certificate.
No prototype status is an approval: the release assessor calls the complete
capacity validator, while the original staging diagnostic stays non-authoritative.

A private candidate can be built with `--release-staging`. Its explicit
CANDIDATE_FOR_STAGING status permits pending checks only on the fixed private
staging project/schema, with fixture-prefixed checkout keys and example.invalid
customer emails. Notification claims and acknowledgements are restricted to that
prefix. It cannot initialize production. The private build can load server
settings from MASTER_WOK_STAGING_CONFIG_FILE; these settings are forbidden on
production, never written to source control and never printed. Supabase does not
support Deno.env.set; normal production configuration uses platform secrets.

## Required server settings

The Edge runtime requires SUPABASE_DB_URL and SUPABASE_URL, MASTER_WOK_RELEASE_ID,
MASTER_WOK_BOOKING_SECRET, MASTER_WOK_NOTIFICATION_SECRET and
MASTER_WOK_DELIVERY_PUBLIC_KEY. Booking and notification secrets must differ.
MASTER_WOK_DELIVERY_PROJECT_REF defaults to the same project. Private staging
may explicitly use the existing production read-only geocode/route functions;
production cannot select a different provider project. The certificate binds
that selection. Keep the Edge JWT setting disabled only because both HTTP
surfaces authenticate their dedicated strong server secrets themselves.

Gateway: use Gunicorn, preserve RTK_PROXY_SECRET and require the configured
booking URL to match its Supabase project. MASTER_WOK_BOOKING_MODE stays LEGACY
until the exact release is approved in the locked database launch control.
The private staging key prefix setting is prohibited on production.

Worker: dedicated process `python -u master_wok_notification_worker.py --loop`,
MASTER_WOK_NOTIFICATION_WORKER_ENABLED=true only after the approved release and
provider checks. Keep existing Twilio/Brevo/Pushover settings server-only and use
the trusted HTTPS gateway for response links. Do not put the worker in every web
process. Monitor process availability, repeated errors and private outbox/delivery
aggregates as documented in the backend notification guide. Quarantined sends
need reconciliation, never automatic resend.

## Controlled cutover

1. After explicit approval, install the reviewed additive DDL in order: capacity
   source column; booking receipts; response receipts; service plans; notification
   outbox/delivery ledger; launch control; write fence. Review existing production
   columns/roles/default grants before applying. Production metadata was read on
   3 November: all commercial/item/customer/service fields used by the runtime
   already exist; capacity_scheduler and the new private runtime tables are the
   reviewed additions. No production SQL has been applied.
2. Deploy the compatibility Pages/backend release with LEGACY retained. Verify
   its existing checkout/admin functions and Access policies. Record these exact
   deployments as the rollback baseline; do not use the pre-Master-Wok website or
   backend as an interchangeable baseline once Master Wok orders exist.
3. Before 16:30 UK time, use createPlanSeeder on the same lock protocol. Preview
   first; only an explicit operator commit seeds the existing legacy commitments.
   The mode and expected revision must still be LEGACY, and no plan may already
   exist. A seed is not permission to create a booking. Running-service cutover
   without trustworthy saved plans is prohibited.
4. Certify the exact runtime digest and complete the final hosted/provider and
   rollback checks. Only then request approval of the specific source versions,
   SQL and operating window. Under the shared lock, set matching approved release
   and MASTER_WOK. The gateway then verifies durable authority before advertising
   availability. Observe the first approved test orders and ledger.

## Rollback preserves data and duplicate protection

Acquire the shared kitchen lock and set DRAINING. The lock waits for in-flight
transactions; subsequent capacity writes fail. Keep the gateway on MASTER_WOK
until its public mode endpoint returns 503 and do not silently fall back while
authoritative results may be unknown. Check receipts for uncertain keys and
retain the browser pending-reference guard. Do not delete receipts, plans, tokens
or notification ledgers to make checkout retry.

Before reopening LEGACY, resolve pending Master Wok time proposals or explicitly
verify every returning scheduler reader preserves both commitments. Pre-release
cached code does not provide that guarantee. Never clear a proposal or confirm a
new time without the customer's acknowledgement. If these prerequisites cannot
be met, remain DRAINING and reconcile rather than accepting unsafe bookings.

Restore the recorded compatibility Pages/backend deployments in LEGACY, leaving
the additive tables/column and write fence installed. Master Wok notification and
loyalty fences must remain: reverting to a backend that can send/redeem again is
unsafe. Quarantined provider results remain quarantined across rollback. Verify
LEGACY/HTTP200, stored commitments, unchanged receipts and no duplicate notices.
This is an operational scheduler rollback; destructive schema removal and a
blind restore of pre-integration binaries are not a safe rollback mechanism.

3 November privilege review: the private staging runtime tables already deny
service_role INSERT/UPDATE and schema USAGE. The production review SQL now
explicitly revokes service_role from receipts, response receipts, plans and
notification ledgers as well as launch control, so public-schema default grants
cannot silently broaden the production API writer. The native SQL writer retains
its approved direct database role. No production grants were changed.
