# Activation follow-up — 23 October 2026

Owner reported saving RTK_EDGE_SECRET_KEY_ENABLED=true in production Edge secrets. Supabase subsequently lists review-order v15, hyper-worker v34 and geocode-order v11; JWT settings remain true/false/true. Their deployed index.ts and helper were fetched again and exactly match the tested candidate. Revisions of the other functions also increased after the secret save; their business code was not edited by this work.

Fresh review-order invocation with a valid public JWT and incorrect admin secret returned401, before any business action. The following hyper-worker request failed at the HTTP tunnel with403 before a service response was available. geocode-order was not attempted after that connection failure. Do not interpret a connection-level403 as an application authorization result or claim the two uncompleted checks passed.

The production zero-row database verification is NOT VERIFIED after activation. Code/config startup and refusal responses are insufficient proof of database authentication. The shared adapter/secret map previously passed staging and the backend previously passed a production read; those remain separate evidence, not substitutes for an activated Edge read.

## Prepared but not deployed diagnostic

read-check.mjs is an optional, fixed production-origin verification handler with a real project enable-flag check, no legacy-key read/fallback, a capability hash/deadline gate, per-isolate attempt consumption, and an outbound allowlist restricted to one GET orders?select=id&limit=0. It refuses all writes, redirects, other tables/origins/query overrides, Bearer backend secrets and providers. Response fields are aggregates only; errors are sanitized. Five new mocked-network tests passed, bringing the local suite to22 tests with no skips. No real credential is used by those tests.

Deployment to a NEW production function rtk-edge-credential-read-check was rejected by automatic approval review before it was created. Reason: a new persistent live endpoint and potentially billable infrastructure exceeded the approved credential verification/no-new-infrastructure-without-cost-approval scope. Function inventory independently confirms the diagnostic does not exist. The unused transient capability file was deleted. Do not retry through CLI, browser, SQL or another endpoint as a workaround.

The optional diagnostic requires explicit owner approval for the additional production endpoint and possible usage cost, plus restored HTTP access to perform the verification. If approved later, issue a fresh short-lived capability, review source/tests, execute only the protected zero-row read, then replace it with an unconditional disabled responder and verify deployed source plus response. Attempt counters are per-isolate, not a durable global once-only guarantee. Do not describe a disabled endpoint as deleted; no deletion tool is currently exposed.

No production DB DML, Google/payment calls or notifications were performed during this activation verification. Legacy key remains enabled. order-confirm source retrieval at its newer v21 still returns unavailable; no claim that it is empty or independent of legacy keys.
