# Staging staff browser and server-route review — 27 October 2026

The isolated browser workflow now talks to separate versioned state and command routes. Real Chromium tests exercise the actual page, localStorage, browser requests, synthetic Access verification, signed service envelope and embedded SQL transaction. The Cloudflare preview is deployed with both API routes explicitly disabled and no data transport or environment credential access. This is a completed local browser/server rehearsal and disabled hosted preview, not hosted staging activation.

Preview branch: rungsthaikitchen/Rungs-Thai-Kitchen preview/staff-browser-2026-10-27. Final preview commit and deployment evidence are in browser-review-results-27-oct.json. Verified canonical preview URL: https://preview-staff-browser-2026-1.rungsthaikitchen.pages.dev/admin-staging/master-wok. The browser visibly shows “Staging route is disabled. No action has been sent.” and every action button is disabled. Cloudflare Pages reports SUCCESS.

The preview branch intentionally has an isolated snapshot tree containing only the new test UI, the two disabled routes, routing/headers configuration and a warning README. It includes no production website, checkout, old admin proxies or deployment workflow. DO NOT MERGE THIS BRANCH INTO MAIN. Production main remains 9e944039a7d1dca9d6a2e2f3995cac589c93ea27; the live admin portal is untouched. No Supabase writes, Railway reconfiguration or customer notifications occurred in this stage.

## Browser workflow

The UI offers only synthetic order actions: offer, confirm, cancel and complete. The unused mark-paid action is excluded. It displays target times in Europe/London and does not request cooking-start confirmations. A completed booking is never treated as evidence of actual cooking or delivery. The API exports only order ID, event revision, status, target and a short fixture proposal-time list; no customer identity, address, money or staff identity is returned. This proposal list is test data, not live availability.

An action is persisted before transmission. A real browser reload resumes the identical saved command, with no automatic resubmission. Unknown/lost success retains that command for explicit retry. Successful replay clears it only after a matching acknowledgement, and the UI then reloads current state instead of assuming a historical receipt is the latest revision. A stale revision requires an explicit “Review latest details” click before a new intent can be created; errors/timeouts cannot silently discard a command. The server still decides revision conflicts under its lock. Sign-in expiry retains the saved intent for retry after reauthentication. Storage quota failure disables actions before any command request.

Actions are disabled during work and on terminal bookings. Browser testing exposed a stale success message during the next asynchronous action; it now shows Working until the action completes. Status text uses allowlisted labels and DOM textContent. The client bundle contains no JWT verifier, hop/actor key handling, Access assertion or database client. Pure command validation was separated into staff-command-format.mjs to keep server authorization code out of the browser bundle.

## Server boundary

createStagingBrowserApi defaults disabled before reading configuration or request fields. It exposes exact POST paths /admin-api/staff-state-v1 and /admin-api/staff-command-v1. Each path uses cryptographic Access verification and fixed origin/path binding when enabled for local fixtures. The legacy action gate retains its original default path; its configurable path is restricted to these three explicit server routes. No new API falls back to the old proxy.

State reads require exactly one orderId and validate the complete returned state, including canonical timestamps and no extra private fields. Commands use the existing signed versioned envelope and atomic transaction. The trusted state reader and envelope sender are server-side injected dependencies. There is no generic SQL/URL endpoint or browser-supplied actor, route or service destination.

The deployed bundles call createStagingBrowserApi with no enabled options, secrets or transport. They ignore environment variables and always return 503 STAFF_BROWSER_STAGING_DISABLED for every method. File hashes are recorded in browser-preview/manifest.json and checked by tests. Both server bundles include the jose MIT notice. The browser and headers are no-store, noindex, nosniff and frame-denied; its CSP permits only same-origin scripts/styles/connections. It has no inline scripts or third-party assets.

## Tests and evidence

- 62 Node entries pass in Europe/London and UTC, including previous transaction/capture tests and new route/state/manifest/default-off checks.
- Six Python tests pass in both timezones, preserving the prior hosted capture and loopback contracts.
- Eight real Chromium cases pass: disabled route, unsigned session refusal, committed-but-unconfirmed offer, reload and exact-ID retry, competing revision review and new intent, sign-in expiry and retry, cancellation with zero remaining holds, and quota failure with no command request. All requests stay on loopback; SQL is embedded, not hosted.
- The nine-case local Workers signed-command/SQL regression still passes after the route changes.
- Cloudflare preview deployment succeeds and the final disabled UI is observed through the cloud browser. The workspace HTTP client receives a generic 403, which is not evidence of Access policy coverage; no such inference is made.

The normal Playwright browser download was unavailable. Tests used installed Playwright 1.62.1 with a temporary @sparticuz/chromium 153.0.0 executable. Unsafe web-security, insecure-content and single-process package flags were removed from the test launch. The temporary browser tools are not application dependencies. Reproduce with CHROMIUM_MODULE pointing to that package's build/index.js and node staff-browser.e2e.cjs, or use an installed normal Playwright Chromium. build-staff-browser.mjs reproducibly builds the eight preview files using the package's pinned esbuild; run it before node --test *.test.mjs.

## Hosted connection still required

The existing staging Railway trial service has no public domain and is intentionally disabled. No suitable Cloudflare administration plugin was found. We therefore did not configure Access, create credentials, expose a receiver or enable persistent runtime use.

1. Protect the entire stable preview hostname above with a dedicated Cloudflare Access application and the intended staff-only policy. Confirm its team domain and application AUD without sharing real tokens or secrets. Do not infer this protection from the existing production application.
2. Prepare a scoped real-staging adapter binding that exact origin, issuer and AUD to the staging project and receiver. The current factories intentionally accept synthetic configuration only; they are not a ready production credential adapter.
3. Configure a staging-only authenticated receiver on the existing test service with a bounded lifetime, fresh fixture/run identities and narrowly reviewed temporary grants. Any change that adds ongoing cost needs cost review under the user's standing approval exception. Install distinct hop and actor keys privately in the appropriate server environments; never in browser code or chat.
4. Supply approved fixture identity/time choices from the server, then repeat the real browser flow through hosted Access/Pages/receiver/SQL. Verify counts independently, disable it, revoke temporary grants and preserve evidence. The prior one-start hosted trial remains spent and must not be reset.

Other dependencies remain: actor-key lifecycle, audit export/retention, real multi-tab conflict UX, route-cutover retries, customer response authority and full lifecycle-writer coverage. No live scheduling behaviour is changed by this review page.
