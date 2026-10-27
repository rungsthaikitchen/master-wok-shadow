Latest: Workers redirect incompatibility reproduced and fixed; Cloudflare Pages deployment succeeded at 06:34:47 UTC. All 34 tests pass in both timezones and the bundled synthetic workerd smoke passes. Actual owner Access login awaits refresh.

# Bounded read-only Access identity check — 27 October 2026

An isolated new Pages function is deployed at `/admin-api/access-check` in website commit `3a16e1bb464cc0f4dc1d4206e82783063ec55dfa`. Cloudflare Pages reported **success** at 06:18:08 UTC. The existing website, admin-action proxy, checkout, backend and notification files were not modified. No Supabase data/policy writes or observer flag changes were made.

This is a narrow production-hosted diagnostic, not activation of the admin-action wrapper or the shadow engine. Standing approval for commits/deploys and the owner's instruction to run the authenticated read-only check were used. It adds no paid service, domain, storage or capacity allocation. Incremental requests/build usage was not measured.

The deployed function:

- Accepts GET only on the configured apex origin and exact probe path, with no query.
- Validates the signed Access assertion against the owner-provided team issuer, application AUD and public JWKS. It requires an application/human token with valid times and rejects the documented machine-token shapes.
- Fetches only the team's public signing keys, with five-second timeout, redirect refusal, no browser credentials and a bounded cache. It contains no booking/DB/notification transport, service secret or API key.
- Returns only a fixed status/scope and zero request counters. No subject, email, IP, nonce, cookie, audience or raw JWT is returned or logged.
- Sends private/no-store responses. Missing/invalid assertions and failed verification refuse safely.
- Stops before signature/key processing after **08:10:45 UTC (UK time) on 27 October 2026**, returning EXPIRED. The source factory defaults disabled; this one diagnostic build explicitly enables it for a maximum two-hour window. That diagnostic flag is unrelated to the shadow observer flags.

The owner-provided hostname pattern is `rungsthaikitchen.co.uk/admin*`; under the documented wildcard rules it should include this API path, subject to any more-specific application or override. Actual header injection and the human login still require a browser request. No real cookie/JWT is requested in chat. A bare-header or cookie-presence check is not a successful identity result.

## Deployment correction and validation

The first website attempt, `546cdc37408006406eb8d5513224b381793034d0`, failed its Cloudflare deployment. The bundle constructed its deadline-sensitive verifier at module scope. A zero request-clock startup reproduction exposed that problem; the corrected entry now initializes the probe on the first request and reuses it afterwards. The owner-facing expiry did not change. The precise first-attempt Cloudflare build log was not available through the connector, so no broader account/build incident is inferred.

The corrected exact bundle passes Node import with no request clock, valid synthetic RSA/JWKS verification, no identity disclosure, POST refusal and expired-state/no-key-fetch checks. All 30 package tests pass in Europe/London and UTC. Wrangler 4.153.0 compiled the complete local Pages function tree successfully. A full local Wrangler server smoke request was not completed in this environment; the local server was stopped. Cloudflare's successful deployment is independent hosted build evidence, not an authenticated-request result.

The single-file browser/Workers ESM bundle is built with pinned esbuild 0.28.2 and jose 6.2.13. It includes jose's MIT license. The isolated dependency audit reported zero known vulnerabilities. The original website has no new root package, build command or runtime dependency configuration.

`deployment/access-check.js` is the exact reviewed artifact, with SHA-256 recorded in `deployment/manifest.json`. The trusted deployment config contains public issuer/audience identifiers, not signing keys or service credentials. The builder accepts a private operator JSON config; without one its source build defaults disabled. Build with `node build-read-probe.mjs /path/to/operator-config.json` and run the package tests. Do not copy a browser token into a configuration file or rebuild an expired probe without an intentional bounded window.

## Required owner check and cleanup

Open the protected URL in the browser used for the admin portal, sign in through Access as usual, and report only the displayed `status`. VERIFIED establishes that this new read-only request received a cryptographically valid assertion for the configured issuer/application and a human identity. It does not prove authorization or transaction coverage of every other admin/customer path.

MISSING_OR_INVALID_ASSERTION, REFUSED, an HTML error or a redirect loop require investigation; do not relax signature/audience checks. EXPIRED requires a fresh reviewed bounded build, not a clock-tolerance bypass. The probe has no endpoint that can accept/cancel/schedule an order.

After the check, remove only the added diagnostic function in a separate cleanup commit, preserving concurrent website edits. The automatic deadline protects the waiting interval but does not delete source. Until the owner returns a VERIFIED result, record the authenticated check as pending. The protected admin-action wrapper remains offline/default-off and the previous staging trial remains disabled.

## Workers key-fetch correction (06:34 UTC)

Owner browser returned KEY_FETCH_FAILED. A workerd reproduction established that Request rejects redirect:"error" with TypeError; this is a runtime option incompatibility. The probe now uses manual redirects and requires HTTP 200 before returning any key response. All 34 tests pass in both timezones, including 301/302/307/308 and non-200 refusals with one fetch only. The offline admin gate uses the same supported option; JOSE rejects non-200 responses there. No verification claims or expiry changed.

The exact deployed probe bundle passed an additional Miniflare 5.20261023.0-beta/workerd smoke: a synthetic RSA token verified using one intercepted public-key request, with no booking/database/notification requests. This is local runtime evidence, not a real Access login. Run runtime-probe-smoke.cjs with MINIFLARE_MODULE pointing at that optional installed module. The smoke uses the current bounded artifact and must run before its expiry.

Website correction commit: 6b9b3696e76d3c37f8cb6bfefd2f4b53dd83323a. Real owner recheck remains pending.
