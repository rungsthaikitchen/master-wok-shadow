# Shadow source credentials and remaining retirement gates — 24 October 2026

Current review is read-only against production. No running collector configuration, observer enable flag, production Supabase function, database record, notification, provider credential or legacy key was changed in this work. The collector patch is isolated on a review branch rather than pushed onto the connected deployment branch. No deployment is requested by this review.

## Transport inventory from code

| Path | Authentication | Effect of anon/service-role key retirement |
| --- | --- | --- |
| Kitchen collector, rest mode | MASTER_WOK_SUPABASE_READ_KEY | Must identify its actual key kind and migrate before disabling it |
| Kitchen collector, management_read_only mode | Project-scoped Database Read PAT in MASTER_WOK_MANAGEMENT_READ_TOKEN | Separate management credential, not the anon/service-role API key |
| Delivery evidence collector and private source checks | Management read-only query endpoint and PAT | Separate credential; current runtime still needs inspection |
| Private event readers/writers | Restricted database-role DSNs | Independent of Data API keys; private role permissions and credential exposure/rotation remain separate |
| Google routing, notification, backup storage and health/operator credentials | Provider-specific credentials | Not rotated by the Supabase API-key migration |

This table is a source-code inventory, not proof of current Railway variables. Railway list-services again returned UNAUTHORIZED/requires reauthentication on24 October. No reconnect loop, credential fetch or browser-session probe was attempted. No secret values were requested or retrieved. Owner dashboard read-back on 24 October confirms production MASTER_WOK_SOURCE_KIND=management_read_only and backend SUPABASE_ORDER_ACTION_URL=https://ubyjrrsvbbqomitpaidb.supabase.co/functions/v1/hyper-worker. These are owner-reported configuration values, not an independent runtime health check. The production kitchen collector therefore does not require this isolated REST-header patch; keep its existing management credential and transport unchanged.

## Collector patch and tests

ReadOnlySource previously sent every key in both apikey and Bearer. New sb_publishable_/sb_secret_ values are application keys, not JWTs. The patch sends recognized new keys only in apikey, retains Prefer:count=exact, and preserves legacy Bearer behavior. Malformed new-key prefixes, empty/non-string credentials and whitespace fail with the existing sanitized INVALID_SOURCE_CONFIG before network access. Management PAT requests still use Bearer on the fixed database/query/read-only endpoint; that branch is not converted to apikey authentication.

Transport remains fixed GET-only for orders/order_items, with strict Supabase origins, redirect refusal, bounded page/result checks and existing is_test/field projection. No credentials, source identity, SQLite path/schema, timestamps, replay rules, recommendations or feature flags were added to persisted data or changed. Runtime changes to source_kind would still require the existing separate-history migration; this patch does not perform one. A GET-only client is not a read-only credential: sb_secret_ still bypasses RLS. Prefer the existing least-privilege management PAT or restricted reader role when available; do not replace a read-only PAT with a broad secret simply to use this patch.

Validation:38 tests passed:5 new transport/header tests,26 collector/persistence/replay tests,4 Management source tests and3 startup diagnostics tests. Both recognized new key types were exercised through the actual urllib Request construction for orders and order_items using a fake opener. Tests assert no Authorization header for new keys, no request body, GET-only, legacy compatibility, sanitized invalid inputs, unchanged management PAT POST-to-read-only endpoint, and redirect refusal. No real network or production credential was used by these tests. No unaffected broad Node/event suite was repeated.

## Remaining confirmation function evidence

Supabase get_edge_function(order-confirm) still returns UNAVAILABLE/internal ProtocolError. Do not equate that with an empty or inactive function, and do not overwrite it with a guessed implementation. The repository order-confirm.html (blob16ff06758d560dc2207ccc0491c86fe2d6ee819f) has no API key and makes GET to the old functions.supabase.co/order-confirm URL with token and decision query parameters. It was inspected as source only; no confirmation URL was opened because GET can change an order.

The verified backend snapshot's notifications.py builds current proposed-time SMS/email links to Railway /orders/{id}/time/accept and /time/decline. The Edge hyper-worker source still constructs the older order-confirm.html links, but both its notifyCustomerEmail call and the helper's sendEmail call are commented out. That identifies multiple historical paths, not proof that every customer link now uses Railway. Old emailed links may remain usable. Owner dashboard read-back confirms the configured backend action target is hyper-worker. The owner also confirms order-confirm still has a blank dashboard Code tab. Its deployed source remains unavailable, not proven empty; leave it unchanged.

## Aggregate production review (no customer data or token URLs)

The reviewed log window was2026-10-23T06:00:00Z through2026-10-24T06:00:00Z, covering the Friday service and credential tests. Only aggregates and log attribute names were selected; no addresses, order IDs, full URLs/query strings, IPs, request bodies, raw key values or notification contents were retrieved.

- function_edge_logs: hyper-worker18 HTTP200 requests and2 HTTP401 requests. This supports actual use of that function; it does not independently prove the configured Railway action URL, count bookings or separate staff actions from diagnostics.
- No matching order-confirm function ID/path records in the reviewed sources/window. This is absence of observed traffic, not proof the function has no callers or can be removed.
- A legacy/new REST credential aggregate contains both legacy service-role and new-secret traffic during that broad window, which spans the migrations. It cannot identify every consuming service or prove all old-key uses have stopped. The narrower midnight-to06:23 orders/order_items query returned no records; that is not a runtime source-mode or collector-health check.
- Read-only database metadata: cron.job and supabase_functions.hooks were absent. Among inspected non-system application triggers, only public.loyalty_accounts/trg_loyalty_updated_at appeared; its arguments had no HTTP/JWT markers. System-schema triggers were excluded. This does not rule out external schedulers/scripts, callbacks or inactive integrations.

Raw analytics activity includes genuine traffic and earlier tests. HTTP200 is not a verified decision event, and no hypothetical cooking/delivery plan is actual activity.

## What unblocks completion

1. Completed by owner dashboard read-back: production kitchen source is management_read_only and backend action target is hyper-worker. No secret values were supplied and no transport migration is needed for this kitchen collector.
2. Recover actual order-confirm source from the dashboard/export if available. If its Code tab is still blank, record that and keep this function unchanged; source retrieval failure alone is not grounds for retirement or a replacement deployment.
3. With Railway read access restored or owner-supplied safe metadata, inspect all live shadow source modes and credential names. Apply any REST patch/migration in staging before considering a collector release. Rotate potentially exposed management/provider credentials separately with their consumers coordinated.
4. Finish consumer coverage and the existing browser overlap/cache transition before switching public-key mode or globally disabling legacy keys. No revocation is authorized by a no-traffic result.

Primary migration guidance already verified during the preceding deployment work: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys . The hosted alias discovery and public/browser rollout are recorded separately under backend-patch/public-key-migration.

## Next event-capture gate — 24 October

The six offline event_cutover_trial safety/budget tests pass again. The hosted concurrency witness remains unrun: fixed offer times and synthetic stream fixtures target 22 October, now past. Regenerate and review matching dates, fixture identities and expected counts before any staging enable; changing only the runner timestamp is insufficient. Existing streams must stay disabled until their state has been checked. Railway authentication is still unresolved; do not treat offline checks as hosted concurrency, lifecycle coverage or production decision capture. No live scheduling change, key revocation or production database write is required to record these findings.
