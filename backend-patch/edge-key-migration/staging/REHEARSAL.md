# Hosted staging credential rehearsal — 23 October 2026

Completed on existing staging project hvrqgufqjslvgiohgkvu. No production deployments, production SQL writes or secret changes. No new project, Railway service or volume. Supabase supplied its staging key environment internally; secret values were never returned to the client, printed or committed. Only the public legacy anon key was retrieved to exercise the diagnostic's existing JWT gateway.

## Results

| Check | Evidence |
| --- | --- |
| No Authorization JWT | HTTP401 before diagnostic logic |
| Valid JWT, no temporary capability | HTTP503 DISABLED, requests0 |
| Legacy-key SDK read | HTTP200 PASSED, one GET orders select=id limit=0, no rows |
| New-key SDK read | HTTP200 PASSED, one GET orders select=id limit=0, no rows; Authorization absent at transport |
| Candidate Deno module loading | HTTP200 PASSED, all three candidate modules loaded, zero business handlers executed and zero network requests |
| Shutdown | Version4 read-back contains only unconditional DISABLED response and empty import map; authenticated POST returns HTTP503/DISABLED/requests0 |

Read results are in RESULTS.json. Diagnostic function id1ec26dce-f08a-49ca-8509-24a911c97d71; versions1 disabled import bootstrap,2 bounded reads,3 captured candidate module imports,4 permanently disabled. verify_jwt remained true throughout. The platform labels the final function ACTIVE because its disabled responder is deployed; no diagnostic or database work remains enabled.

The deployed read probe used the reviewed helper and actual pinned SDK2.118.0 in Deno. It internally selected legacy/new modes without changing any project environment flag. Both modes used only staging credentials. The new mode read the platform-provided SUPABASE_SECRET_KEYS JSON map; no manual key entry was needed. Allowed transport was one GET per accepted request, to the fixed staging origin and orders path, select=id, limit=0, no extra query keys, no redirects, eight-second transport timeout. Every write and provider destination was refused. Two authorized test invocations made two actual database reads. Invalid-token/JWT checks made no DB request.

Access required the platform JWT gate plus a random temporary capability, with only its SHA256 digest embedded in the diagnostic and a20-minute deadline. The original capability existed only in a private transient local file; that file was deleted during shutdown. Attempt counters are per isolate, not durable or global exactly-once enforcement. The deadline/capability limited exposure; version4 removed all executable diagnostic logic and imports, making expiry or isolate reuse irrelevant after verified shutdown. Repeating these tests requires a new deliberately deployed diagnostic; do not reuse old gate material.

## Module rehearsal isolation

The three generated index.ts candidates and adjacent helpers were packaged unchanged. A rehearsal-only import map replaced their pinned std serve imports with serve-shim.ts. The shim captures registrations and never invokes handlers. module-probe.ts dynamically imported each candidate while global fetch was replaced by a refusal guard. All three registered successfully without network activity. This verifies hosted SDK resolution, TypeScript transpilation/module initialization and import compatibility, not Deno static type checking or successful booking execution. The candidates selected their environment-configured path on initialization; no global RTK flag was changed. The separate enabled SDK probe proves the shared new-key transport with staging environment JSON.

Production review-order/hyper-worker/geocode-order JWT settings were not changed or deployed here. The test function's JWT gate was verified; this is not a live authorization test of each production function. In particular, gatewayfalse hyper-worker relies on its unchanged admin-secret check, tested offline. Do not describe this diagnostic as a complete hosted lifecycle replay. No acceptance, rescheduling, payment, notification or Google geocoding action was executed.

## Investigation and cleanup

The first shutdown deployment omitted the previous import map. Supabase rejected it with an inherited-path error and left the prior version in place. The corrected shutdown supplied an explicit empty deno.json/import_map_path and succeeded as version4. Its deployed source was independently read back, then an authenticated POST confirmed DISABLED/requests0. A method-based disabled response from the prior diagnostic was not used as proof of permanent shutdown.

Local validation:17 tests passed with no skips, including eight new probe safety tests plus nine credential/handler tests. Probe cases cover capability/deadline refusal, production-origin refusal, invalid payload/config refusal, bounded actual SDK reads, rejected writes/nonzero limits, sanitized failures, import-failure cleanup, attempt consumption and restoration of the global fetch guard.

## Remaining production gates

- Re-fetch deployed function versions/hashes before preparing a production upload; never overwrite unseen changes.
- Keep incoming JWT/admin-secret settings unchanged for the internal-key migration. Browser publishable-key migration needs separate caller handling.
- Confirm desired project-level flag rollout: the same new-key enable/name variables affect all installed candidates. Do not enable them globally before all intended functions and key names are ready.
- Obtain order-confirm source, verify the actual admin-action target, and inspect remaining shadow/webhook/cron/external consumers before legacy-key retirement.
- The old legacy key remains active. Nothing in this rehearsal revokes it or proves the rest of the application has migrated.
