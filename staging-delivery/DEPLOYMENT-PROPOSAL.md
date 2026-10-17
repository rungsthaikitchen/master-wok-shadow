# Isolated staging route test — ready for deployment review

Prepared 17 October 2026. No push, deployment, real routing request or production change has been performed. This is a small provider connectivity test, not delivery shadow activation.

## Exact proposed scope

- New GitHub branch: delivery-route-staging, based on the reviewed repository baseline. Put the supplied code on this branch, not main. Existing collectors must remain on their current approved revisions/branches. Check their watched branches before any push so this test cannot trigger either collector's redeployment.
- New service: master-wok-delivery-route-test in existing Railway environment master-wok-staging. Do not replace bubbly-presence or the production shadow service. No public domain, web health check, cron, persistent volume or Supabase credential is needed.
- Build context: contents of the master-wok directory; existing railway-shadow/Dockerfile, which includes Node. Start command: node staging-delivery/route_test.js. This file imports only the provider boundary, not either collector or the booking backend.
- Source test data: staging-delivery/route-test-input.json uses public landmark names: Morley Town Hall, Morley Leisure Centre and Morley Railway Station. The alias KITCHEN represents the Town Hall only in this test; it is not RTK's actual location. Provider resolution of these names has not yet been tested. No customer, restaurant-home or production order locations are used.
- Traffic policy: DRIVE / TRAFFIC_UNAWARE, matching the supplied existing route function. Request only routes.duration. This is an estimated duration, not traffic prediction or proof of a journey.
- Maximum six network requests in one process, sequential and with no retries. Validate the full input and reserve the request budget before any call. Each HTTPS request has a five-second wall-clock deadline and a 64 KiB response limit. Non-200 responses and redirects are refused; fail the batch at the first error. No partial batch is labelled complete.
- Railway restart policy: Never. No scheduled trigger. Manual redeploys or another process each create a new six-request budget; this is NOT a persistent account-wide spending cap. Do not repeatedly redeploy after failures; review the redacted error first. Use a separate restricted staging Google key and provider-side quotas for wider cost control.

## Deployment sequence after approval

1. Verify the existing production/staging collectors' watched branches, create the staging branch and commit the reviewed package there. Creating a branch alone is not deployment approval for a collector.
2. Create only the new service and select the staging branch. Set RAILWAY_DOCKERFILE_PATH=railway-shadow/Dockerfile and the start command above. Disable automatic restarts and do not attach a health monitor to this one-shot process.
3. Set MASTER_WOK_ROUTE_TEST_ENABLED=false and MASTER_WOK_ROUTE_TEST_LIVE_REQUESTS=false for the initial deployment. Set MASTER_WOK_ROUTE_TEST_INPUT=/app/master-wok/staging-delivery/route-test-input.json. Confirm Railway supplies RAILWAY_ENVIRONMENT_NAME=master-wok-staging. Do not copy production variables.
4. Supply MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY as a private Railway service variable. It must allow Routes API requests from this server. Never paste it into chat, a source file or GitHub. A browser-referrer-restricted key will not work as a server key. Creating/configuring this private staging key is an outstanding access dependency; no key has been read or created by this implementation.
5. Deploy disabled first. Expected log: DISABLED, verified=false, networkRequests=0. The process completes intentionally. A completed one-shot service is not supposed to remain Up like the collector.
6. Only within the approved test window, set both flags true and run one deployment. Success is ROUTE_ESTIMATES_CAPTURED, directionalLegs=6, networkRequests=6, durationEvidence=PRESENT, persistence=NONE. No duration or location is printed. A failure prints a fixed reason and count, with no raw provider body or key.
7. Set both flags false after the one-shot run; keep restart policy Never. Verify neither existing collector changed revision/configuration. Route failure is isolated from checkout and existing monitoring.

No concrete Git SHA exists for these new files until they are committed; verify the new service's linked commit before enabling requests. This proposal does not reuse the production approval for d1f370fc543e49130dae93a72932184aad728f4f.

## What success establishes

The staged key, HTTPS request shape, independent directional queries, duration parsing and redacted operational logs work against Google. Free deliveries use the same provider path. Tests also connect mocked provider evidence to the real dated RTK kitchen/driver assessment in memory, with approved two-minute loading, two-minute handovers and minimum five-minute combined saving.

This smoke test intentionally does NOT read live orders, build a complete kitchen/driver manifest, persist recommendations, compare actual bookings or change checkout. Those remain separate integration work; a successful six-leg lookup is not proof of end-to-end delivery scheduling readiness.

## Data handling and provider requirements

Real responses remain in memory only. No raw response, duration, coordinate or route-derived recommendation is saved by the staging runner. It emits a minimal provider-health summary. Do not redirect raw real-route results into test fixtures, reports or a durable route cache without a reviewed retention basis under the applicable provider agreement. Google's Routes policies describe restrictions on cached content and attribution requirements. The memory-only design is a conservative technical choice, not a legal assessment of every possible retention scheme. No new route display is introduced; emitted provider attribution is Google Maps.

Official references checked for this implementation:

- https://developers.google.com/maps/documentation/routes/compute_route_directions — fixed HTTPS computeRoutes endpoint, POST request and field mask.
- https://developers.google.com/maps/documentation/routes/reference/rest/v2/Waypoint — address or geographic coordinates as mutually exclusive waypoint representations.
- https://developers.google.com/maps/documentation/routes/policies — provider policy, storage and attribution requirements.

No provider pricing is assumed. The proposed approval is for at most six potentially billable Compute Routes calls in one controlled run, not ongoing polling. Actual charges depend on the account's plan, usage and terms.

## Tested and remaining dependencies

Provider tests use injected transports and clocks; HTTPS mechanics use fake request/response streams. Failure paths cover direction/point coverage, maximum budget, credential redaction, HTTP errors, no redirects, malformed/oversized response, timeouts and cancellation. The live HTTPS network/key integration, Railway deployment and container build have not been executed here. Existing Docker image uses Node 22; local test logs reflect the available workspace Node version, not a completed container test.

Required next: approval for the staging branch push, isolated service deployment and one maximum-six-request live test; a privately configured server-side staging Routes key; and confirmation of the linked deployment revision. None authorises production deployment or Supabase writes.

Full local verification: 100 Node test runner entries pass in Europe/London and UTC; 56 Python tests pass. npm test now selects the spec reporter explicitly so saved test logs include individual results and totals even when the runtime's default reporter emits no test text to redirected output. Local Node is 24.19.0.
