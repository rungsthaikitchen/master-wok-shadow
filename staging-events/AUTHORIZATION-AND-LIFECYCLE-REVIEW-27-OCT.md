# Authorization and lifecycle integration review — 27 October 2026

This review identifies the remaining trust boundaries and supplies an offline, default-off **staging admin authorization gate**. No production code, database policy, order, route, deployment or notification was changed. No customer rows or customer links were accessed. Existing read-only saved-state monitoring does not require this gate to keep running; authoritative actor-labelled event capture is a separate integration step.

## Current-source findings

Website main remains `55938bc73cd762be614a300ef54bacaedda5f6b0`. The inspected function excerpts have checked hashes and Git-blob provenance in authorization-source-characterization-27-oct.json. Source behaviour is demonstrated locally with synthetic data and mocked calls; repository content is not proof of the currently served revision or traffic history.

| Boundary | Evidence | Required treatment |
|---|---|---|
| Guest checkout -> customers | getOrCreateCustomer selects by supplied email, then phone, and updates an existing name/address before inserting orders | Email/phone/customer_id do not prove identity or authorize editing an existing customer's profile. Keep guest order submission separate from account/profile ownership. |
| Admin caller -> Cloudflare proxy | callOrderAction sends JSON with Content-Type only; no bearer token | A new bearer gate cannot be dropped into the live path alone: it would block today's caller. Stage the paired identity flow first. |
| Cloudflare proxy -> Railway -> Edge | Proxy forwards every parsed payload with its server RTK_PROXY_SECRET; owner-supplied Railway source checks it and forwards ADMIN_SECRET | Service secrets authenticate hops, not the initiating human. The inspected proxy contains no independent user check. External Cloudflare Access policy remains unknown. |
| Supabase public data access | SELECT-only metadata confirms anon SELECT/INSERT/UPDATE ACLs for customers and orders, RLS enabled, and permissive public SELECT/INSERT plus anon customer UPDATE / public order UPDATE policies | RLS being enabled does not make those operations owner-restricted. Existing public customer reads/updates are a concrete hardening issue. Do not carry these permissions into a new authorized boundary. |
| order_items | Same anon table ACLs, but inspected policies only grant SELECT/INSERT behaviour | An UPDATE table grant alone does not prove effective UPDATE access under RLS. Do not confuse ACLs with the combined policy result. |
| Customer time response | Railway owner-supplied GET handlers and separate order-confirm Edge route remain separate contracts | Admin authorization is not customer acceptance. Retain proposal/token/revision-specific validation and a separate response boundary. |

The production policy read was metadata only; it did not enumerate customer records or attempt an exploit. The public-customer policy issue should be addressed with a separately reviewed guest/profile access plan. Broad revocation now could break checkout and the admin portal, so no live RLS/ACL changes are included. The restricted admin order policy does not override a separate permissive public UPDATE policy. Protecting a web admin page would not itself narrow the Supabase public table policies.

The recursive website tree contains no repository middleware or Wrangler/routes/headers configuration establishing an identity boundary. This is not evidence that Cloudflare's dashboard has no Access policy. Current user identity/access protection must be verified before deciding whether a verified Access JWT or Supabase Auth is the smaller live integration. This candidate demonstrates the Supabase Auth option only; it does not impose a new customer login requirement.

Supabase metadata still lists hyper-worker v35 ACTIVE, review-order v16 ACTIVE and order-confirm v22 ACTIVE. hyper-worker and review-order bundle hashes match the previous reviewed sources. A fresh get_edge_function call for order-confirm still returned ProtocolError/UNAVAILABLE. Do not treat it as empty, overwrite it or invoke real customer links to diagnose it.

## Offline admin gate

`createAdminAuthorizationGate` is not imported by the website, Railway runtime or any deployed Edge Function. It performs no database or network calls itself. It is disabled by default before touching request data or configuration. Enabled construction refuses production project configuration and requires a server-supplied verifier, explicit UUID-subject allowlist and command callback.

The contract is:

1. Only POST mutations with a bounded Bearer header reach the verifier. Shared secrets, cookies, Origin, actor/body fields and claimed email are not identity evidence for this candidate.
2. The trusted server verifier must cryptographically validate the **provided token**, returning the Supabase `getClaims` result shape. Never replace it with JWT decoding or a browser claims object. The injected test verifiers are stubs, not evidence of real token/JWKS validation.
3. The gate checks the pinned issuer, authenticated audience/role, explicit nonanonymous claim, configured subject, expiry and optional issuance/not-before times. It checks expiry after the asynchronous verifier completes. Email and user_metadata do not grant access. The server allowlist is copied when constructed.
4. Only then does it call the supplied command callback with an immutable minimal actor context. The actor contains no token, email or metadata. The callback also receives the original request so it can validate the command; the gate does not log or independently forward credentials.
5. Identity approval is not command approval or a committed receipt. The existing command transaction must still validate fields, action, resource scope, idempotency and current proposal revision, and return a committed result before reporting success.

[Supabase getClaims documentation](https://supabase.com/docs/reference/javascript/auth-getclaims) describes signature verification and Auth-server fallback. A real pinned SDK adapter and hosted test with synthetic admin accounts remain dependencies. No SDK version/dependency was added in this isolated module. The verifier's network timeout, session revocation policy and safe HTTP error mapping must be specified at integration. Local claim checks do not independently validate a JWT signature, prove session non-revocation or protect a directly accessible database path. The empty/not-configured allowlist fails closed; no real admin subject was read, guessed or embedded.

## Lifecycle responsibilities remain distinct

| Producer | Identity/authority needed | Reservation/event rule |
|---|---|---|
| Guest checkout | Server-issued bounded submission capability, trusted customer-link resolution and complete quote/basket binding; no claimed customer UUID as ownership | Persist complete basket once. Record submitted/requested data without inventing acceptance or historical cooking. |
| Admin offer/confirm/cancel/complete | Verified retained admin identity and action/resource authorization | New offer replaces the previous hold at server offer time. Confirm resolves the reviewed effective target. Cancel/complete release as defined. |
| Customer accept/reject | Verified current offer capability, proposal revision and bound origin/order; POST confirmation for new links | Acceptance converts the existing hold; current-offer rejection releases it. Old responses cannot affect a newer offer. |
| Kitchen progress | Authorized staff action, separate from admission/response authority | A Preparing status is not proof that cooking occurred. Do not turn progress into acceptance. |
| Console/unknown legacy writer | Actor/intent may be unknown | Keep coverage incomplete; any later row-change audit must be labelled ROW_CHANGE_NOT_DECISION_HISTORY. |

The added local integration uses the real SQL candidate after a stub-verified admin gate for offer/confirm/cancel/complete only. Customer accept/reject use a separate explicit trusted proposal-response fixture, not admin authority. Its signed response origin is mandatory. This test verifies one hold through repeated offers/acceptance, idempotent retries, stale response refusal and release after rejection. It does not verify a live customer's token or persist the actor to SQL.

Existing production discrepancies remain **unfixed**: the reviewed live suggestion can retain an old confirmed_time, the current schedule helper prefers that confirmed time, and legacy rejection/status handling can preserve a rejected target. Your proposed-time business rule therefore must not be assumed live. Original preferred time should remain history, not a second hold; no implicit expiry is introduced. None of these findings authorizes changing live scheduling without the requested review.

## Smallest rollout sequence

1. Keep read-only shadow monitoring and its uncertainty labels. Review the existing customer-data policy exposure independently of engine capacity calculations.
2. Establish the current external admin access boundary. Retain it if appropriate, verify its token on the server, and test the paired caller/proxy path using synthetic identities. Do not deploy this isolated gate alone.
3. Define guest submit/profile separation without repricing orders or adding an unnecessary customer login. The trusted quote must bind the whole complete payload, identity/capability, request/order, target and expiry. Freeze the delivery address used for that order privately rather than inferring it later from an editable customer profile. Stored distance is still not travel duration.
4. Resolve order-confirm source and retained response links, then test each retained writer through the authorized transaction. Main and both alternate checkout pages and the kitchen board must be covered or explicitly retired. Scope exclusions remain visible.
5. Prepare a writer-by-writer integration diff and baseline/cutover plan. Capture-only production database writes require separate explicit approval; standing commit/deploy approval does not override the no-production-Supabase-writes rule. Avoid changing customer-visible capacity while validating history capture.

29 Node entries pass in Europe/London and UTC: 11 authorization gate tests, three current-source characterizations, one local authorization/lifecycle integration and 14 full-payload persistence entries. Tests use synthetic data and mocks or local PGlite. This is an offline review result, not a hosted authentication rehearsal or completed production authorization rollout. No new paid infrastructure, live configuration or staging permissions were changed in this stage.
