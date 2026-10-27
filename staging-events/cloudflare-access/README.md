Owner probe returned REFUSED; safe diagnostic categories are now deployed. Refreshing the same bounded read-only URL will identify the failure category without disclosing identity or token data. See READ-PROBE-27-OCT.md.

Latest: [bounded read-only identity probe](READ-PROBE-27-OCT.md) is deployed and awaiting the owner browser check. It expires at 08:10:45 UK time on 27 October. The action wrapper remains offline; no booking or database changes were activated.

Latest: [protected HTTP proxy adapter review](PROXY-REVIEW-27-OCT.md), 22 combined test entries per timezone. Offline/default-off; hosted integration still needs actual team/AUD/API coverage.

# Cloudflare Access admin gate — offline review candidate

The owner confirmed that the admin site already uses Cloudflare Zero Trust Access. Reuse that sign-in boundary. The earlier Supabase Auth gate is an alternative contract, not a proposed second login. This package has no production imports, deployed route, account configuration or database changes.

`access-gate.mjs` validates the signed `Cf-Access-Jwt-Assertion` header before its command callback. It uses pinned **jose 6.2.13**, RS256 and the configured team's fixed `/cdn-cgi/access/certs` endpoint, with issuer/application-audience/expiry checks. Requests cannot choose a key URL through JWT iss/jku/x5u. The key fetch omits browser credentials, refuses redirects and has a five-second timeout. JWKS is cached for five minutes with a 30-second refresh cooldown. Unknown keys fail closed during cooldown; a fresh verifier can accept a newly served valid key. Live Cloudflare rotation/outage behaviour still needs a staging check.

The configured Access application's policy is the authority for its allowed people. This requires an admin-specific application/policy: any human admitted by that audience can reach the guarded command callback. The gate requires a nonempty signed subject and an application token, and excludes the documented machine-token shapes. It does not inspect plain user-email headers or grant access based on email strings, service secrets, cookies or a claimed body identity. Raw email/IP/country/nonce/JWT are excluded from its minimal actor context. Session/policy revocation may not invalidate an already issued JWT immediately; live session lifetime and revocation requirements need review.

Only the exact configured HTTPS origin and `/admin-api/order-action` JSON POST are accepted. The browser Origin must match. Requests to other paths, with a query, wrong Origin, non-JSON content, GET/OPTIONS or oversized/malformed assertions are refused before key retrieval. An outer integration must provide non-mutating preflight handling if needed. Existing same-origin browser JSON calls can retain their current login flow **when Access protects the API path and injects the assertion there**. No cookie or bearer fallback is used.

The callback receives the original request plus an immutable private actor context. It remains responsible for command validation, resource scope, request idempotency, proposal revision, transaction commit and safe error responses. The actor is not yet persisted by SQL and is not an engine export field. A verified admin identity does not authorize a customer's accept/reject response. Customer response signing and guest checkout remain separate boundaries.

## Configuration needed before hosted integration

The owner has confirmed Access on the admin site. We have not read the actual application configuration or received a real token. Obtain these **non-secret** values privately:

- Access team domain: `https://<team>.cloudflareaccess.com`.
- The intended admin application's AUD tag.
- Protected hostname/path entries, including whether `/admin-api/order-action` is covered by that application.
- A staging admin origin and a reviewed admin-only Allow policy for a synthetic identity rehearsal.

The dashboard's AUD is an application identifier, not an API key. No account API token, service-token secret, session cookie, JWT or private signing key is needed in chat. Store actual deployment values in service configuration, not this public review package.

Cover the required admin/API paths explicitly; do not protect the public guest checkout merely to obtain an API assertion. Verify the served staging build, actual assertion injection, intended Allow versus Bypass/Service Auth policies, signed issuer/AUD binding and direct-origin behaviour before activation. Source-level shared secrets can remain as service-hop checks after user verification, but do not replace it. No live Access policy or website file has been changed here.

The factory is **disabled by default** before reading request/configuration. Enabled configuration refuses the production Supabase project ID; that is a staging scope guard, not an actual database/host enforcement mechanism. The HTTPS request origin is independently bound. The example contains disabled placeholders and no real credentials. `onAuthorized` and optional test fetch/clock dependencies are trusted server configuration, never request inputs.

## Verification

13 tests pass in each of Europe/London and UTC. They generate RSA key pairs in memory and verify actual signatures through jose and a mocked, fixed JWKS endpoint. No private keys or real Access tokens are saved. Tests cover valid identities, forged/HS256/unsigned tokens, wrong team/application, expiry/not-before/issued-at claims, machine tokens, malformed headers, path/Origin/content restrictions, key retrieval failure, cached keys, unknown keys, private actor fields and expiry during key lookup.

The integration test uses the existing local SQL candidate: a valid signed synthetic admin token reaches an offer transaction; a forged token makes no SQL change; repeated offers remain idempotent with one hold; customer-response commands are refused at that admin callback. It is not a live Cloudflare login, Pages Worker deployment, SQL actor-audit implementation, complete response-lifecycle test or production authorization proof.

The isolated dependency audit reported zero known vulnerabilities on 27 October 2026. This is scoped to this pinned package, not the entire project or a guarantee against undiscovered vulnerabilities.

Reproduce from the repository root:

```sh
npm ci --ignore-scripts --prefix staging-events/cloudflare-access
TZ=Europe/London npm test --prefix staging-events/cloudflare-access
TZ=UTC npm test --prefix staging-events/cloudflare-access
```

The existing root dependency tree and deployed runtime dependency files are unchanged. `node_modules` is local only and must not be committed. No hosted grants or flags were enabled in this stage; the previous full-checkout rehearsal remains disabled.

## Next change

The offline HTTP wrapper is now prepared. The owner verified a real Access login on the bounded read-only probe on 27 October; the probe was then removed successfully. The configured team/AUD are confirmed for that exact diagnostic request, not every route. Next, bind the wrapper to a staging-only fixed Pages transport preserving existing action payloads and service-secret forwarding. Rehearse with a synthetic Access identity and bounded non-customer command destination. Review that concrete diff before any live route activation. The earlier public Supabase customer/order policy exposure remains a separate hardening task; protecting an admin website does not narrow direct Data API permissions.

References: [Cloudflare origin JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [application token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
