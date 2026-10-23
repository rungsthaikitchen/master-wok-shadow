# Credential support deployed — activation pending

23 October 2026. The owner approved proceeding after reviewing the hosted staging rehearsal. Production Edge code deployments were performed; no production database DML, booking decisions, notifications or external provider requests were performed by the verification checks.

Immediately before deployment, raw source SHA256, version and verify_jwt for all three functions matched the original source-manifest.json. Each deployed index.ts and edge-credentials.mjs was fetched back and compared exactly with the tested candidate. An explicit empty deno.json import map was included; no authorization setting was changed.

| Function slug | Previous version | New version | verify_jwt | Safe live check |
| --- | --- | --- | --- | --- |
| review-order |13|14|true| Missing JWT401; valid public JWT plus incorrect admin secret401 |
| hyper-worker |32|33|false| Incorrect admin secret without JWT401 |
| geocode-order |9|10|true| Missing JWT401; valid public JWT plus incomplete body400 |

The existing hyper-worker function kept its id and URL slug. Supabase normalized its display name from order-action to hyper-worker on deployment; this is not a new function or URL migration.

These checks prove deployment/module startup and the stated refusal paths, not successful order processing or new-secret database authentication. All payloads were missing or invalid for business actions and stopped before database/provider operations. Existing user authorization, CORS and full handler bodies are preserved by the candidate build. Scheduling rules were not edited.

## Owner dashboard action

No secret-management tool is exposed in this session. In production Supabase project ubyjrrsvbbqomitpaidb, Edge Functions → Secrets, add RTK_EDGE_SECRET_KEY_ENABLED with value true. This is an ordinary custom flag, not a key value. Do not put the production secret in chat. Leave RTK_EDGE_SECRET_KEY_NAME unset so the adapter uses the platform-provided SUPABASE_SECRET_KEYS JSON entry named default (the production default secret was already created by the owner). Do not recreate or overwrite the platform JSON environment variable.

No secret configuration was read or changed during this rollout. The code defaults to the old path when the flag is absent or false. The actual production flag value has not been independently inspected. Enabling this shared project flag switches every installed candidate simultaneously; these three have now been installed and checked. No other deployed function was edited. The helper fails closed on invalid JSON/key name/key format rather than returning to legacy credentials.

After saving, check fresh invocations and source startup/refusal paths again. Do not infer authenticated database access from a401 or400 response alone: those intentionally stop before DB work. The new-secret transport and platform JSON were verified against real staging reads; production Edge database access with the switched credential still needs read-only evidence before claiming end-to-end completion. Do not submit a live test order or trigger completion/loyalty/notifications to obtain this evidence.

The old key remains active and must not yet be disabled. Website/public Edge callers, order-confirm source, actual admin proxy target, shadow runtime configuration and other external consumers remain separate gates. The existing backend new-key read evidence does not establish migration of these functions or the rest of the application.

Machine-readable deployment/readback and HTTP outcomes: PRODUCTION-SUPPORT-RESULTS.json. Local17-test suite and staging evidence are unchanged by this documentation update.

Activation follow-up: owner reported saving the flag. New function revisions and unchanged deployed source/JWT settings were verified. Production Edge DB authentication remains unverified because the extra diagnostic deployment was rejected by automatic approval review and direct HTTP verification hit a tunnel403. See production-verify/STATUS.md and PRODUCTION-ACTIVATION-RESULTS.json.

Verified follow-up: explicit owner approval resolved the diagnostic deployment block. Production Edge runtime reported RTK_EDGE_SECRET_KEY_ENABLED=true and successfully authenticated a single orders select=id limit=0 read with the new secret. No returned customer rows, DB writes, notifications or provider calls. Diagnostic version2 was replaced with an unconditional disabled responder and independently verified by source read-back plus authenticated HTTP503/DISABLED/requests0. Previously blocked hyper-worker/geocode-order refusal checks also passed (401/400). See production-verify/VERIFIED-RESULTS.json. Earlier blockers above are historical; legacy-key retirement remains incomplete.
