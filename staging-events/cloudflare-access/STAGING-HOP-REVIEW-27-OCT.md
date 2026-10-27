# Protected action service-hop rehearsal — 27 October 2026

The protected proxy now has a runnable synthetic staging Pages adapter. It fixes the browser origin, Access issuer and downstream destination to synthetic hosts, defaults disabled, and accepts only explicitly synthetic service credentials. The upstream contract matches the inspected live Pages proxy: POST /admin-order-action with x-rtk-proxy-secret and the existing action JSON. It never points at live Railway or an Edge function. This is local staging code, not a hosted staging deployment.

The adapter adds a five-second abort signal, manual redirects and no browser credentials. Only the service credential and Content-Type reach the downstream hop. Access JWT, browser Authorization, cookies, email and actor are not forwarded. Wrong identity/origin and payload injection stop before the service request. Every response keeps no-store; upstream cookies are removed. Redirects fail with 502; 409/500 remain errors; there are no retries. No paid resources were created.

## Findings and fixes

The first local Workers rehearsal refused a valid synthetic token before any key fetch. Temporary synthetic-only diagnostics established a TypeError: native fetch was invoked as a configuration-object method. The gate now invokes its captured transport as a standalone function. A regression test checks the receiver, and the temporary diagnostic logging was removed. This fixes an offline candidate; the live action proxy was not changed.

All 41 Node test entries pass in Europe/London and UTC. The esbuild-bundled adapter additionally passes 13 local Miniflare/workerd cases: all five existing action shapes, invalid assertion, cross-origin request, injected actor, repeated action, redirect, conflict, server error and actual five-second abort against a six-second delayed synthetic response. Eleven action requests and one key request were intercepted; no production, database or notification requests occurred. The fixtures merely acknowledge mark_paid; this does not approve the known legacy completion fallthrough.

## Boundary still to implement

The legacy UI sends no durable command ID or expected offer revision. Identical HTTP actions therefore produce identical repeated downstream requests. We deliberately neither retry nor invent a request ID from body/time; a legitimate later repeat proposal must remain distinct from retry of the same proposal. The prior SQL duplicate tests prove only callers that retain the same trusted request ID, not browser reload recovery through this adapter.

The browser Access actor is verified but omitted from the legacy service body. A service secret authenticates a hop, not the initiating person. The transaction/event layer still needs a trusted actor envelope and revision-bound command identity. Local signature and HTTP tests are not proof of hosted Access coverage or atomic database capture.

## Smallest next integration

1. Add a versioned staging command envelope separate from the legacy JSON contract: stable per-intent command ID, expected current offer revision and server-verified actor context. Keep user-supplied identity fields forbidden.
2. Have the staging receiver validate the trusted hop and submit that envelope to the existing atomic command/reservation/event transaction. Reuse the command ID on timeout/retry; create a new ID for a repeat proposal.
3. Rehearse duplicate/reload, competing proposals, stale acceptance, rejection/cancellation and lost success responses against fixtures. Keep booking/notification providers intercepted.
4. Only after that evidence, prepare a concrete hosted staging route diff and rollout/rollback plan. Live availability, checkout and production Supabase remain outside this stage.

Run Node checks from this directory: TZ=Europe/London node --test *.test.mjs, then TZ=UTC node --test *.test.mjs. For the runtime script, set MINIFLARE_MODULE to an installed Miniflare 5.20261023.0-beta module and run node runtime-staging-rehearsal.cjs. The runtime script bundles in memory, intercepts every outbound request and fails on any destination other than the two fixed synthetic hosts. Its synthetic credentials are not real secrets. No real browser token is needed.
