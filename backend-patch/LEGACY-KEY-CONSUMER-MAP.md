# Legacy Supabase key consumer map — 23 October 2026

Scope: read-only inventory. No production database writes, key revocations, website edits, Edge deployments or JWT setting changes.

## Backend transition evidence

Owner committed the three credential files to order-backend at 105b0845f3f4d50542d7daf575b2cd5642837669. GitHub connector access to that repository remains denied (404). Owner logs show deployment 126fc57f-cf9b-4254-9dbb-2d49670d0695 started on Python 3.13.16 after entering SUPABASE_SECRET_KEY privately. Offline tests were on Python 3.12; no claim of a complete Python 3.13 regression run. A live POST /loyalty-balance with synthetic phone +440000000023 returned HTTP 200, ok:true, and a loyalty summary. Inspected handler calls the SELECT-only get_loyalty_account_by_phone path, not get_or_create_loyalty_account; no writes or notifications. Startup alone does not prove DB authentication; this read supplies additional evidence. New-key precedence follows the prepared helper and owner variable action; runtime key mode/commit cannot be independently inspected through Railway OAuth.

Staging fixture trial shutdown confirmed by owner logs: deployment1358299b-984d-4792-a3bb-923d33bf83be, build63219288b33ff25bbc6d23fcfab3bb0a7bf5361b, DISABLED/requests0. Logs do not independently prove deletion of the temporary variable.

## Initial consumer findings (23 October; follow-up updates below)

| Consumer | Evidence | Migration dependency |
| --- | --- | --- |
| order-backend | Owner code/key deployments plus live SELECT path passed | New secret is in use according to owner action and helper precedence; legacy variable/key not revoked |
| Website index.html | Current repository main blob1102ab8c713a0dba5a0a5df8745871ca8a2ef688; legacy public key declarations | Swap to publishable only after updating direct Edge headers/caller compatibility; identify active declarations rather than global literal replacement |
| Website admin.html | Current repository main bloba5e5aeaad1244a69bc6e5f52dbb02122691f2b11; legacy public key declaration | Supabase user session JWT authorization must remain supported |
| review-order | Deployed v13, verify_jwt=true; SUPABASE_SERVICE_ROLE_KEY; x-admin-secret validation | Migrate internal DB credential separately from inbound authentication; preserve admin-secret checks |
| hyper-worker (display name order-action) | Deployed v32, verify_jwt=false; SUPABASE_SERVICE_ROLE_KEY; x-admin-secret validation | Migrate internal DB credential; preserve independent caller verification |
| order-confirm | Deployed ACTIVE v20, verify_jwt=false; source retrieval unavailable | Obtain/review actual source and callers before declaring legacy independence; do not describe as empty |
| geocode-order | Deployed v9, verify_jwt=true; SUPABASE_SERVICE_ROLE_KEY | Internal DB key plus admin caller JWT compatibility |
| get-delivery-route-quote | Deployed v5, verify_jwt=true; Google key, no internal Supabase key read | Public checkout directly sends legacy anon in apikey AND Bearer; cannot blindly replace with publishable in Bearer |
| geocode-address | Deployed v6, verify_jwt=true; Google key, no internal Supabase key read | Checkout SDK functions.invoke caller compatibility |
| Polled shadow collector | Source supports rest and management_read_only; runtime configuration unavailable | REST source sends key in both apikey and Bearer and needs new-key compatibility if used. Management source uses a separate management token, unaffected by anon/service_role retirement; token exposure/rotation is separate |
| Other shadow services, scripts, cron/webhooks | Runtime inventory incomplete because Railway OAuth unavailable | Read variable NAMES and source mode, not secret values; check external/manual consumers before revocation |

Website repository contents are current main, not independently verified Cloudflare deployment contents. Public-site fetches failed; no live page equivalence claim. Three JWT-looking strings in index include at least one commented-out declaration; this is not three proven active clients. admin has one. Never store key values in this inventory.

## Caller chains observed in current website repository

- index: Supabase client -> geocode-address via functions.invoke; direct fetch -> get-delivery-route-quote with apikey plus Bearer legacy public key; checkout -> Railway send-order-confirmation.
- admin: Supabase client -> geocode-order via functions.invoke; admin -> Railway send-order-confirmation. These source references do not prove every operational call actually occurs.
- Railway admin action forwards x-admin-secret to the configured SUPABASE_ORDER_ACTION_URL. Active target has not been independently verified. Do not assume every deployed admin function is used.

Production SQL metadata scan searched function definitions for embedded JWT markers, legacy key variable references and outbound HTTP patterns without returning function bodies/credentials. Only extensions.grant_pg_net_access matched. This does not exhaust cron-job arguments, trigger arguments, external webhook configuration or other services; no universal absence claim.

## Safe order of work

1. Prepare and test Edge internal-key adapters for review-order, hyper-worker and geocode-order. Use documented new key environment JSON, require configured named key, pin/test SDK behavior and new-key headers. Preserve handlers and inbound authorization. Stage before production.
2. Recover order-confirm source and verify actual action-function target. Separately inspect cron/webhook configuration with redacted metadata, not secret values.
3. Prepare browser publishable-key update and corresponding Edge caller handling. Do not merely disable verify_jwt: preserve user-session authorization and add an explicit appropriate caller check where needed. Public delivery/geocoding access already existed with the public anon key; avoid accidentally removing its only request gate or broadening privileged endpoints.
4. Confirm Cloudflare deployed source and shadow service source modes. Migrate any REST shadow key headers and rotate management tokens/DSNs separately where relevant.
5. After all consumers pass, disable/revoke applicable legacy keys using Supabase's verified scope. Do not reset global JWT signing settings or revoke both anon/service_role blindly. Removing a Railway variable does not revoke its value. Do not restore a potentially exposed key as routine rollback.

Reference checked: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys . It documents parallel old/new key support, SUPABASE_SECRET_KEYS/SUPABASE_PUBLISHABLE_KEYS JSON environment maps, apikey-only transport for new keys, and the built-in JWT gate limitation. Documentation is guidance; actual function auth must be reviewed before migration.

Production support follow-up: reviewed credential adapters installed in review-order v14, hyper-worker v33 and geocode-order v10 after exact source comparison and safe denial-path checks. Incoming JWT settings retained. No secret flag changed; new-key activation and production Edge DB read verification remain pending. See edge-key-migration/PRODUCTION-ROLLOUT.md. Legacy key retirement remains blocked by the other consumers above.

Activation verification complete for the shared Edge adapter/environment: approved protected diagnostic made one production zero-row read using the actual enabled flag/new secret and was permanently disabled afterward. Existing updated function refusal checks passed. See edge-key-migration/production-verify/VERIFIED-RESULTS.json. This is credential authentication evidence, not an end-to-end live booking test or migration of remaining legacy consumers.

24 October website rollout: main in Rungs-Thai-Kitchen now points to b4db919971e6163f014bed29892176ccfa42a5b1 and Cloudflare Pages reported successful deployment. Public homepage uses the publishable key/pinned SDK, with zero legacy JWT literals. Admin source is in the same deployed commit; served admin content is protected by Cloudflare Access and was not independently inspected. Both legacy/publishable callers pass input validation on all three public geocoding/route guards in verified dual mode. Global legacy-key retirement remains pending other consumers; no credential revoked. See public-key-migration/WEBSITE-ROLLOUT-RESULTS.json.
