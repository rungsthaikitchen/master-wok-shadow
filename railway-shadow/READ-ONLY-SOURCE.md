# Optional Management API read-only source — review candidate

Status: local mocked-transport tests pass. No scoped token has been supplied to the runtime; this endpoint has NOT yet been exercised against staging or production by the collector. It is beta in Supabase documentation. Existing staging REST monitoring remains running unchanged. Production activation is not yet ready.

## Why this option

The production catalog was inspected through two explicitly READ ONLY metadata transactions, using the broadly capable ChatGPT connection. No customer/order rows were read and no grants, roles, functions or data were modified. This limited metadata inspection resumed after the user's request to progress production access; the connection itself is still not project-scoped/read-only and must not be treated as the collector credential.

Required projected columns match the production schema. No master_wok_reader role exists. No PUBLIC table grant was found on orders/order_items; grants to anon/authenticated remain broad. A PUBLIC-executable SECURITY DEFINER function named get_next_order_number was also found. Its body was not executed or inspected in this check; its name/volatility alone does not prove its effects. Creating a new role with SELECT alone would not resolve all inherited function-access questions. No production permission changes have been proposed for immediate execution.

Supabase documents POST /v1/projects/{ref}/database/query/read-only as running SQL under supabase_read_only_user, requiring database:read / fine-grained database_read. A project-scoped token with only this permission can avoid a new database role, JWT signing keys and changes to existing website policies. It is a database-wide read credential, not a column-scoped credential: this tradeoff must be accepted before production use. The adapter itself projects only the existing minimal order/item columns and strips customer information as before. Project-scoped token permissions must be checked in the Dashboard; the code cannot establish a token's other scopes from its opaque value.

Official references:
- https://supabase.com/docs/reference/api/v1-read-only-query
- https://supabase.com/docs/guides/platform/personal-access-tokens

## Safety and tests

The optional adapter accepts only a validated Supabase project origin and constructs a fixed api.supabase.com /database/query/read-only endpoint. There is no fallback to the write-capable /database/query endpoint. Although the HTTPS method is POST to carry a query, its payload is a fixed parameterized SELECT; it does not request a database write. Date bounds and limits are parameters, never interpolated user SQL. Redirects are refused; response size/time/row bounds apply. Missing/duplicate rows, malformed responses and any source_role other than supabase_read_only_user fail closed. One aggregate response row avoids API row caps silently clipping the item list. The existing two-snapshot equality check and incomplete-item safeguards remain.

Four new tests cover exact request method/path/SELECT/parameters, unproven role, partial payloads, duplicates, row caps, invalid origins, missing token and date validation. These tests do not prove the hosted endpoint's availability or actual token permissions.

## Staging validation — next required access step

1. In Supabase account Personal Access Tokens create a NEW fine-grained token, scoped only to rtk-master-wok-staging, with Database Read only. No write permissions, no organization-wide access, no keys/secrets access. If the Dashboard cannot provide this scope, stop and review; do not substitute a legacy broad PAT or service_role key. Set a short suitable expiry and record the rotation date privately.
2. Store its value directly in the staging Railway variable MASTER_WOK_MANAGEMENT_READ_TOKEN. Do not paste it into chat or GitHub. This is a different credential from MASTER_WOK_SUPABASE_READ_KEY and MASTER_WOK_HEALTH_TOKEN.
3. Only once the token is available, upload the revised railway-shadow/shadow_collector.py to the staging-only repository. Other existing runtime files are unchanged. The package includes the new tests and docs.
4. Set MASTER_WOK_SOURCE_KIND=management_read_only and use a NEW dedicated DB path /data/master-wok/management-readonly-staging.sqlite3. Keep source URL pointing to staging. Retain the old DB, volume and pseudonym key. Source kind deliberately forms part of identity, so the transport change cannot silently adopt the existing REST history.
5. Stop the old staging deployment, retain one replica, and run python railway-shadow/shadow_collector.py --once --service-date 2026-10-15 for a same-day synthetic validation (use the fixture's service date if performing later). Expected orders=3, state=OBSERVED, prediction=UNVERIFIED. Expired, wrong-project or wrong-scope credentials must fail; never enable a write scope to clear a failure.
6. Validate the exact returned response shape, expected counts, all projected fields and role attestation before calling this path hosted-tested. Record safe error codes if the beta endpoint behaves differently from documentation.
7. Restore python railway-shadow/monitored_collector.py and verify Better Stack returns Up. The health token and public URL remain unchanged. Planned validation downtime may alert the owner; do not disable monitoring permanently.

## Production approval boundary

After staging validation and backup readiness, obtain explicit approval for a concrete independent production collector configuration. It must have its own volume/database, source identity, pseudonym secret, health token and a separate token scoped only to the production project with Database Read only. Keep disabled by default until approval. No policies/roles need modification for this candidate approach. Do not repoint the staging service/DB to production or reuse staging secrets. Initial samples remain approximate saved-state comparisons, not a complete current-engine decision log or confirmed cooking evidence.

## Rollback

Stop staging, restore MASTER_WOK_SOURCE_KIND=rest (or remove it), restore the original monitor DB path and existing REST credential, then redeploy the previous tested collector build/command. Keep the new history separate for review. Existing v2 source/build handling supports normal build changes; do not delete either database. No production database rollback is needed because this work makes no production changes.

## API-key header compatibility review (24 October)

An isolated review patch makes optional REST reads send new publishable/secret API keys only in apikey, while preserving legacy Bearer headers and the separate management PAT Bearer path. It does not change source_kind or enable a collector. See SOURCE-KEY-COMPATIBILITY-REVIEW.md for38 passing tests, no-deployment scope and runtime-access gaps. A new secret API key is still privileged; GET-only transport must not be confused with a least-privilege read-only credential.
