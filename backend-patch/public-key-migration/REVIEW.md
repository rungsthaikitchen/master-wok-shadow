# Public browser key migration — 23 October 2026

Current state: three production caller guards installed in legacy compatibility mode, current website/main unchanged, browser candidate commit prepared but not published. No production database writes, live test orders, notifications, payments or Google requests were performed. Full machine-readable outcomes are in RESULTS.json.

## Scope and compatibility

The existing checkout and admin repository files use an anonymous Supabase client. No Supabase sign-in flow appears in admin.html. Both pages therefore need publishable-key compatible Edge calls. Previously get-delivery-route-quote, geocode-address and geocode-order had verify_jwt=true and accepted the project's publicly distributed anonymous JWT. Their handlers did not perform individual staff/user authorization. The geocode-order handler writes order coordinates with privileged server credentials; the public application key was already sufficient to reach that operation. This migration preserves that application-key access policy; it does not fix the separate individual-admin authorization gap. Do not describe a publishable key or a public page key as proof of staff identity.

For these three functions only, the platform JWT gate is replaced by an explicit application-key guard. verify_jwt=false was deployed in the same bundle as the guard; there was no unguarded intermediate version. OPTIONS retains existing CORS behaviour. The inserted guard runs before parsing business payloads or calling providers/DB. No scheduling, pricing, order lifecycle or Google/DB business code was changed. All other production functions' caller-auth settings were left as they were. Known browser calls send apikey; historical anonymous-JWT-only calls remain accepted while the legacy mode is allowed. Arbitrary user/server JWTs without a recognized application key are not accepted by the new guard. Unknown external JWT-only callers need inventory before key retirement.

## Hosted failure that changed the implementation

The first staging attempt compared old callers with Deno.env.get('SUPABASE_ANON_KEY'). It failed: old JWT callers were denied and modern-key callers were admitted in legacy mode. A bounded diagnostic returned format booleans only and confirmed that this staging environment's SUPABASE_ANON_KEY contains sb_publishable_, not eyJ. Incoming headers retained their original formats, so the mismatch was not a gateway rewrite. No key values were returned by the diagnostic. This finding occurred before any production guard deployment.

The corrected guard never reads SUPABASE_ANON_KEY. The builder validates the known website JWT's anon role/project reference, requires exactly one distinct key across its literal copies, and pins only its SHA256 fingerprint in each Edge bundle's legacy-public-key.mjs. The website key was independently compared with production's active legacy anon key from the key-management API and matched. No service-role/secret key is embedded in browser or Edge guard configuration. A regression test refuses any read of the mutable alias. Fingerprints must be rebuilt if the legacy public key changes during the transition; publishable-only mode ignores the legacy fingerprint entirely.

## Modes

RTK_EDGE_PUBLIC_KEY_MODE defaults to legacy. Its allowed values are:

| Value | Accepted public credentials |
| --- | --- |
| legacy | Exactly the pinned current legacy anonymous JWT, in apikey or historical Bearer form |
| dual | Pinned old anonymous JWT and the named modern publishable key |
| publishable | Named modern publishable key only; all legacy paths are rejected even if old environment variables remain |

Modern keys come from SUPABASE_PUBLISHABLE_KEYS JSON, selected by RTK_EDGE_PUBLISHABLE_KEY_NAME (default default). Invalid mode/key maps fail closed with503. Missing/wrong credentials return401. A wrong supplied apikey cannot fall through to an otherwise matching legacy Bearer token. The key is public application admission, not user identity; unrelated user Authorization headers are irrelevant to these public-capability handlers when a recognized application key is supplied.

## Validation and deployments

15 local tests passed, no skips. Tests use the actual pinned SDK2.118.0, including its browser UMD artifact. Anonymous functions.invoke emits apikey and no fake Authorization JWT. Browser candidates' inline scripts compile, external SDK URLs point to the pinned artifact, legacy literals are removed, direct route lookup drops its legacy Bearer header, and no order/capacity code is edited. Successful original/candidate function responses and synthetic Google/DB effects match for all three functions across allowed key modes. Rejected credentials cause no mock provider/DB effects. The initial UMD sandbox lacked WebSocket; after providing the browser-supported WebSocket API the test passed. This was a test-environment defect, not a site change.

The existing staging diagnostic master-wok-edge-key-rehearsal was reused: initial probe versions5/6 exposed the alias mismatch, corrected version7 passed all seven hosted cases (capability refusal, legacy admission/new-key refusal, dual admission for both, publishable-only old-key refusal/new-key admission). It required a short-lived random capability in addition to its public-key checks and made no outbound requests. verify_jwt=false was used only with that independent capability check. Version8 restored verify_jwt=true and an unconditional DISABLED responder; deployed source and authenticated HTTP503/DISABLED/requests0 were verified. Transient capability file deleted. Counter bounds are per-isolate, not a durable global once-only guarantee.

Fresh production source hashes matched the manifest immediately before installing the guards. Installed bundles were independently fetched and compared exactly with candidates:

| Function | Before | Installed | verify_jwt |
| --- | --- | --- | --- |
| get-delivery-route-quote |6|7|false, explicit key guard |
| geocode-address |7|8|false, explicit key guard |
| geocode-order |11|12|false, explicit key guard |

Nine safe live checks passed: for each function, no key returned401, the real existing website key with an incomplete payload reached normal input validation and returned400, and the modern key returned401 before dual mode. None reached Google or DB business operations. A separate existing Data API GET orders?select=id&limit=0 with the real production publishable key returned200 and an empty array. That proves read authentication, not successful browser booking writes. No live booking write, geocoding request or end-to-end checkout was exercised.

## Prepared website commit and next action

Repository rungsthaikitchen/Rungs-Thai-Kitchen main remains cb39250cc2d1d6de03b090a8183db4ae5ba30c62 (verified after preparing). Candidate commit b4db919971e6163f014bed29892176ccfa42a5b1, parent that exact main, contains only index.html/admin.html. It is currently an unreferenced review commit: no branch/main ref was moved, so no website deployment was requested. It can be regenerated from the committed builder/review patches if needed. Do not publish it until dual-key support is enabled and verified. No preview site pointing at production data was created.

Owner dashboard action required because no secret-write tool is exposed: production Supabase → Edge Functions → Secrets, add RTK_EDGE_PUBLIC_KEY_MODE=dual. Leave RTK_EDGE_SECRET_KEY_ENABLED=true and all actual keys/secrets unchanged. This allows a controlled overlap for the old live website and the prepared publishable-key version.

Then verify modern and legacy caller admission using incomplete payloads (no provider/DB side effects), re-check website main/source lease, and move main to the prepared commit only if still based on the same source. Inspect Cloudflare's deployed commit and served pages before claiming website rollout. Public site retrieval was unavailable earlier; repository main does not prove Cloudflare deployment equivalence. Never force-overwrite newer site changes.

After the new site is confirmed and a suitable cache/session transition has been considered, switch the guard mode to publishable and verify old-key refusal. This alone does not authorize global legacy-key deactivation: order-confirm source, review-order/other inbound caller dependencies, shadow runtime credentials and external scripts/webhooks remain to be resolved. No legacy credential was revoked by this work.

## Reproduction

Use npm ci --ignore-scripts in ../edge-key-migration for the shared locked SDK dependency, then run RTK_PUBLIC_KEY_SOURCE_DIR=/absolute/snapshots npm test here. Snapshots are required; tests do not silently skip them. Builder command: python3 build-candidates.py --source-dir /absolute/snapshots --output-dir /absolute/candidates --publishable-key-file /absolute/public-key-file. Input hashes, original key role/project and key format are checked. Browser review patches redact both public key literals. Live candidate source remains in the website repository review commit; full baseline files were not duplicated into this audit repository.

Official references checked: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys and https://supabase.com/docs/guides/functions/secrets . Observed hosted environment behaviour takes precedence over assuming an environment variable's historical name identifies its present format.
