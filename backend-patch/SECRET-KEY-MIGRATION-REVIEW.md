# Supabase backend key migration candidate — 22 October 2026

Prepared offline only. No service variable was read, changed or revoked; no deployment or production Supabase write was performed. Creating new keys alongside legacy keys does not retire the potentially exposed old credential.

## Evidence

The owner confirmed the live Railway backend variable SUPABASE_SERVICE_ROLE_KEY starts with eyJ, and created default publishable and secret keys in production Supabase. Secret values were not supplied. Railway OAuth is unavailable to this session. On 23 October the owner supplied the GitHub archive for the commit linked by the active Railway deployment, 51616be77f92fcfd99958e8d784361eb232073a5. All three archived files match the previously supplied files byte-for-byte. This closes the supplied-source comparison gate; direct connector retrieval and installed production dependency versions remain unavailable.

This candidate applies to the exact supplied server(1).py, SHA-256 ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88. It uses both create_client and direct REST requests for booking/loyalty operations. The original requirements.txt has unpinned flask, twilio, requests and supabase. The original direct REST helper sends its key in both apikey and Authorization: Bearer. The examined supabase-py 2.33.0 also supplies a Bearer header by default. These observations establish header construction, not a demonstrated production authentication failure.

The admin proxy separately forwards x-admin-secret to the configured Edge function. This candidate preserves that separate contract; migrating the database key does not rotate ADMIN_SECRET or RTK_PROXY_SECRET.

## Candidate files and behaviour

- server-secret-key.py.patch: targeted patch only; does not replace the whole backend or add the earlier staging customer-response patch.
- rtk_supabase_credentials.py: place beside server.py when reviewed for the backend repository. An explicitly set SUPABASE_SECRET_KEY must contain the new secret format. Empty, malformed, publishable and legacy values in that new variable fail startup without echoing the value or silently reverting to the old key.
- Without that variable, the existing SUPABASE_SERVICE_ROLE_KEY path and original client creation are preserved. Existing deployments do not import this module.
- Direct REST calls put a new secret only in apikey. For the SDK, the public ClientOptions custom HTTP client and HTTPX request hook remove Authorization only when it equals this backend secret. This does not strip an unrelated user JWT. The client refuses a different destination origin and disables automatic redirects. New-key clients do not persist user sessions or auto-refresh them; this backend uses server table operations.
- requirements-secret-key.txt: complete pinned dependency snapshot from the isolated Python 3.12 compatibility environment, including the original four backend packages and HTTPX. This is a candidate backend requirements replacement, not a change to the shadow image. Review other backend files/build constraints before adoption.
- test_secret_key_compatibility.py: offline tests using actual SDK table builders with HTTPX MockTransport, exact-source patch application, mocked notifications and direct HTTP calls. Dummy credentials and synthetic.invalid only. No provider authentication is tested.

No order status rules, proposal handling, pricing, capacity calculation, endpoints or notification logic are changed. Existing legacy response issues described in PRODUCTION-CAPTURE-REVIEW.md remain unresolved by this separate credential patch.

## Rollout sequence and remaining gates

1. Source comparison completed using the owner-downloaded deployment commit archive (see below). Before applying, check that no newer backend commit/deployment has appeared. Still confirm Python/runtime dependencies and every backend consumer; do not overwrite unseen changes on the backend branch.
2. Exercise this candidate against a staging project with its own secret, validating database access, loyalty and the existing admin proxy contract. Local mock tests do not prove real platform acceptance. Do not place the production secret in staging or into chat/source control.
3. Confirm Railway build/deploy access and its current credential-recovery guidance. Use a dedicated production backend secret key rather than sharing one key with every service. Enter the replacement directly through the service's secret configuration when rollout is ready.
4. Deploy the reviewed credential patch and pinned requirements to the backend with the new variable. Verify the running commit and read-only database access. Plan any live functional write/notification checks explicitly with the owner; no such checks are authorized or performed by this review.
5. Migrate every other consumer before disabling the legacy key system: website/admin public anon clients, deployed Edge function environment reads and caller authorization, shadow services, direct scripts, other environments and database webhooks if present. Replacing this one backend variable is insufficient. Do not turn off Edge JWT checks without an equivalent verified authorization check.
6. Revoke the old credential at Supabase using the documented mechanism applicable to the project. A UI control that disables both legacy anon and service_role must wait for public clients too; verify exact scope before using it. Removing the Railway variable alone does not revoke its value. Do not blindly reset the JWT signing secret, which can affect other clients and sessions.
7. Recheck consumers and review bounded provider/service logs for unexpected access. A successful functional check is not evidence that no earlier access occurred. Keep a record of replacements and revocations, without secret values. Do not restore a potentially exposed old key as routine rollback; use another fresh key or take the affected function offline if necessary.

Railway recommends prompt rotation after its disclosure. Build/OAuth restrictions obstruct coordinated rollout but do not make leaving the old key active safe. If timely migration remains blocked, containment may require accepting a service interruption; agree that operational choice with the owner before revocation. Do not infer that RTK was specifically compromised from the platform disclosure alone.

## Other credential dependencies from owner screenshots

| Credential | Coordination required |
|---|---|
| ADMIN_SECRET | Match Railway and the active Edge action verifier; locate all copies |
| RTK_PROXY_SECRET | Match Railway and the website/Cloudflare admin proxy |
| BREVO_API_KEY / SENDGRID_API_KEY / SMTP_PASS | Confirm active sending path, replace there, verify delivery, revoke old or unused credentials |
| TWILIO_AUTH_TOKEN | Check SMS and any webhook verification dependencies; use provider-supported rotation |
| PUSHOVER_APP_TOKEN / PUSHOVER_USER_KEY | Check notification destinations and provider replacement/revocation options |
| Management read tokens / staging reader-writer DSNs / routing API key / bucket credentials / health and operator secrets | Inventory each shadow service separately; none are covered by the live backend screenshots |

Addresses, URLs, port numbers and account identifiers are configuration rather than authentication secrets in this inventory. Do not rotate them merely because their variable names appear beside credentials. SMTP_USER may identify an account or API-key username; check the provider before changing it.

## Primary references

- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd
- https://blog.railway.com/p/security-disclosure-wednesday-october-21st

Validation: nine offline tests passed, no skips, with the exact supplied backend path configured. The patch also applies cleanly before the earlier staging route patch. The actual SDK 2.33.0 issued mocked GET/POST/PATCH requests with apikey only, and the hook preserved an unrelated user JWT. pip check reported no broken requirements after installing all four original backend packages; the resolved environment is pinned in requirements-secret-key.txt. No actual Supabase credential or real endpoint was used. Python 3.12 was tested; notification delivery and full loyalty business behaviour were not exercised by this credential-focused suite. The existing 97 event tests were not repeated because this candidate is not imported by that runtime.

Reproduce in an isolated environment by installing requirements-secret-key.txt, then running unittest discovery in backend-patch for test_secret_key_compatibility.py with MASTER_WOK_REVIEW_SERVER_PATH pointing to the exact supplied source. Keep all real production credentials out of that environment.

## Deployment commit archive follow-up — 23 October

The owner opened the active deployment's GitHub link, which points to https://github.com/rungsthaikitchen/order-backend/commit/51616be77f92fcfd99958e8d784361eb232073a5, then downloaded its Browse files archive. GitHub connector reads for this commit still returned 404. The archive contains only the three expected backend files; archive paths and member sizes were checked before extraction.

| File | SHA-256 | Compared with earlier supplied copy |
|---|---|---|
| server.py | ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88 | Identical |
| notifications.py | 34ace2ae84a5f141a8620fa7feefc2706165c7efd0616a4d4af83f53ec050577 | Identical |
| requirements.txt | 979a71fb94b9cec1c60306b555fdfc46780d8c3339bbf08633a51ccef4e99129 | Identical |

notifications.py reads Brevo, Twilio and Pushover credentials and implements their sending paths. It does not reference SENDGRID_API_KEY or SMTP_* variables. That is evidence about this source, not proof that those credentials have no consumers elsewhere. Removing unused variables alone would not revoke the provider credentials.

The old isolated test environment had expired. A first wider-suite attempt failed because Flask and psycopg were absent from the refreshed base runtime; these were environment dependency errors. Recreated the isolated environment from the committed requirements snapshot, then installed psycopg[binary]==3.3.6 for the separate event suite. Final reruns against the extracted server.py passed: nine credential compatibility tests and all 97 event tests, with no skips. pip check passed. The archive SHA-256 is 09bd51b23c88be71f252b77dcea5e9990a59c94594eb7145d87af466f4946e46. No production endpoint or notification was exercised. Real staging authentication and the wider consumer/revocation review are still required.
