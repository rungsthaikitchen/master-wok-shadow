# Route-to-assessment trial — prepared 18 October 2026

Local preparation only. Not committed, deployed or executed against Google.

The new runTrial composition calls the existing Google staging adapter and then the existing RTK kitchen/driver assessment through createStagingComparison. Default disabled; staging and live-request switches must both be explicit. No database credentials, database writes, scheduler, file persistence or live booking integration.

The input must be a complete two-order synthetic fixture (A and B), with test flags, an explicitly hypothetical empty existing plan and PUBLIC_LANDMARKS location basis. A declaration of public landmarks is not proof: review all three supplied points before approving any network run. The one-shot CLI is staging-delivery/route_assessment_once.js; its container definition is staging-delivery/Dockerfile.route-assessment. The CLI accepts no external input file and fixes all points to Morley Town Hall (hypothetical kitchen), Morley Leisure Centre (A) and Morley Railway Station (B).

Source assessment must be no more than 15 minutes old. The CLI generates a fresh fixture for the current London service day, using synthetic orders targeting 19:00 and an explicitly hypothetical empty plan. It refuses runs outside 06:00–15:59 London time. The existing static October 17 fixture is only for deterministic tests; it cannot be run live now unchanged.

Scope for a future approval: one isolated staging run, exactly three reviewed public landmark locations, up to six Google Compute Routes requests, no retries, no customer locations, no Supabase access. Provider estimates and derived comparison records stay in memory; only redacted aggregate status/counts may be printed. No persistence approval is implied. Six requests are a request-count cap, not a currency quote. Existing route-test flags remain disabled. No network run is authorized by this preparation.

The run returns UNVERIFIED on invalid source, insufficient complete route evidence or assessment failure. All recommendations are hypothetical. Successful synthetic execution would demonstrate integration, not accuracy on actual bookings.

Tests: 135 Node entries pass in Europe/London and UTC, including eight new tests for disabled/production guards, route-to-assessment integration and redaction, preflight rejection, partial provider failure, stale source rejection, explicit CLI scope flags, and summer/winter offsets. Tests use injected fake transport and make zero provider requests.

Deployment sequence: review module/tests and three public points; approve code commit and bounded provider scope; use the included one-shot entrypoint pinned to the approved commit; deploy only to a dedicated staging service with no database credentials and restart NEVER; execute once; inspect terminal result; disable both switches. Do not change production observers or checkout.

Production integration still needs decision-time source snapshots, complete dated kitchen/driver commitments, approved customer-route handling and estimate retention, and a persistent redacted comparison journal. Current saved-state polling cannot reconstruct original decisions or prove actual driver activity.

## Concrete proposed rollout scope

Commit only these eight new/updated package files to delivery-route-staging, then create a dedicated staging-only service using Dockerfile.route-assessment, pinned to that new commit. No volume, database credentials, public domain, cron or healthcheck; restart policy NEVER. Reuse the existing private staging Google key by service-variable reference without exposing it.

First deploy with MASTER_WOK_ROUTE_ASSESSMENT_ENABLED=false and MASTER_WOK_ROUTE_ASSESSMENT_LIVE_REQUESTS=false and verify zero requests. Only after approval, set both true and MASTER_WOK_ROUTE_ASSESSMENT_REQUEST_BUDGET=6, execute one daytime deployment, inspect the terminal aggregate result, then reset both false. No automatic rerun on failure. Maximum six Google requests for this run, separate from the previously consumed route-test budget. No customer information or production access.

Authorization is requested for this complete scoped commit/deployment/test, including the potentially billable six-request maximum. No run has occurred during local preparation.
