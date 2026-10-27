# Protected admin proxy HTTP adapter — 27 October 2026

The offline/default-off `protected-proxy.mjs` now connects the signed Access gate to a bounded HTTP/action adapter. It is not a deployed Pages function and has no network destination, service secret, database client or provider code. The trusted `forwardAction` dependency is injected by a future reviewed server adapter. No production file or Access policy was changed.

The factory returns a 503 disabled response before reading request or configuration when disabled. Enabled construction requires the existing staging scope/team/AUD/origin configuration and an explicit forwarder. The signed Access check completes before the request body is read. Unauthorized requests never reach action validation or the forwarder.

The adapter preserves the five inspected admin UI payload shapes:

| Existing action | Payload fields |
|---|---|
| accept | action, orderId |
| decline | action, orderId, reason |
| suggest_time | action, orderId, proposedTime |
| mark_paid | action, orderId |
| complete | action, orderId |

Current source is website commit `55938bc73cd762be614a300ef54bacaedda5f6b0`; call sites in admin.html and the previously hashed proxy/hyper-worker sources were inspected. The wrapper preserves values and action names, including the ISO offset and decline reason, without changing their business meaning. UUID/date/type/field restrictions apply to this candidate and require compatibility review before any deployment. The current UI supplies those shapes; arbitrary old external callers are not thereby verified compatible.

`accept` here is the existing **admin booking action**. A customer's acceptance of a proposed time still requires its separate response path/capability/revision. The wrapper rejects extra proposal/token/actor/route fields and the customer-only `reject` action. It does not remove the existing mark_paid UI path or correct its previously characterized legacy fallthrough behaviour. It does not change confirmed/proposed time precedence, capacity, notifications or SQL history.

A validated action object is the sole argument passed to forwardAction. Browser headers, cookies, Access JWT and actor metadata are not forwarded. The Access gate's private actor context is intentionally not attached to the old action body; authenticated actor persistence/attestation needs a separate trusted transaction integration. Payload validation does not prove transaction commit or authorization of another route.

Request input is capped at 65,536 bytes during stream reading; malformed UTF-8/JSON and unsupported fields refuse before forwarding. JSON uses the current proxy's parsed-object semantics and is forwarded as an object, not as raw bytes; duplicate-key rejection is not implemented here. Any future canonical event-command boundary must define that rule explicitly. No automatic retry is performed because the legacy admin path has no reviewed idempotent command receipt yet.

The forwarder returns a Response. Its status/body/content type are preserved, including errors and no-content responses; no success is fabricated. Other upstream headers, including Set-Cookie, are not relayed. Responses are no-store. Redirect responses, a non-Response result, thrown forwarder failures and replies over 131,072 bytes return a static upstream-failure response. The injected network adapter must itself enforce destination pinning, credentials, request/body timeouts and redirect refusal: this HTTP wrapper does not make that network call. Authentication errors are static 403 responses; request validation errors are 400/413; disabled state is 503. Safe HTTP mapping does not redact an intentionally returned backend error body for an authorized admin.

## Public configuration check

Two unauthenticated GETs were attempted for the known site admin page and API path. Both returned HTTP 403 with server header `envoy`, no usable Access redirect or team/AUD metadata. No POST, customer response link, cookie, token or live action was sent. These responses do not establish whether Cloudflare Access covers either path or reveal the actual application policy; no configuration value was inferred from them.

Hosted integration is blocked on the real non-secret team domain, intended application's AUD, protected hostname/path entries and staging origin/identity plan. The owner confirmed the existing admin sign-in uses Cloudflare Zero Trust Access; exact API coverage remains unverified. No connected Cloudflare account tool is available in the current tool set.

To locate the AUD, the current official documentation points to **Zero Trust > Access controls > Applications > Configure > Additional settings > Application Audience (AUD) Tag**. Provide configuration identifiers privately; no API key, Access JWT, session cookie or service-token secret is needed. Verify that the intended policy covers `/admin-api/order-action`, not only admin.html, without placing guest checkout behind admin login.

## Verification and next step

22 Node test entries pass in each of Europe/London and UTC: 12 real-signature gate tests, one signed-token/local SQL test and nine proxy tests. They cover authorization before body reads, all five existing action payloads, forged identity/route injection, malformed/large input, operator error propagation, private-header exclusion, redirects, no-content and bounded replies. Forwarding is mocked; no real backend, account configuration, notification or live order is touched. The isolated jose dependency and its lockfile are unchanged from the prior audited package.

Once the actual settings are available, bind this adapter to a staging-only fixed transport with a bounded synthetic destination, then exercise actual Access assertion injection and the existing UI action shapes. Do not import this module into the live proxy or change public database policies before that review. Existing read-only saved-state shadow monitoring can continue while these actor/capture dependencies are resolved.

Reference: [Cloudflare AUD tag and JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
