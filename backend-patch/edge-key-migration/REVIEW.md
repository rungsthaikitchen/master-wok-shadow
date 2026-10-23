# Edge database credential candidates — 23 October 2026

Prepared and tested offline. Nothing has been deployed. No production SQL writes, notifications, Google requests, key revocations, caller-auth changes or scheduling changes.

## Scope

Credential-only patches for deployed review-order v13, hyper-worker v32 (display name order-action), and geocode-order v9. The source manifest records exact retrieved and newline-normalized SHA-256 hashes and current verify_jwt settings (true, false, true). Sources were fetched from production using read-only get_edge_function. Entire serve handlers and all following helper text are unchanged. Function bodies before serve are also retained by an invertible two-replacement build assertion. Full function sources are kept in the local review workspace; only narrow patches and fingerprints are committed here.

The shared edge-credentials.mjs exports edgeDatabaseClient. RTK_EDGE_SECRET_KEY_ENABLED defaults off (absent or false). Off preserves original factory arguments and the legacy credential selection. True requires SUPABASE_SECRET_KEYS JSON with a valid sb_secret_ value, selected by RTK_EDGE_SECRET_KEY_NAME (default default). Malformed/missing configuration fails with sanitized codes, without returning to the legacy key. This project-level flag affects every deployed candidate that imports this helper; stage them together before enabling it, or use a separately reviewed per-function rollout. Do not set it globally in production yet.

The enabled client disables session persistence/refresh and supplies an outbound fetch wrapper. New secrets go in apikey; an Authorization header is removed only when it exactly equals Bearer plus that backend secret. An unrelated user JWT is retained. Requests are restricted to the configured HTTPS origin's REST paths and redirect following is refused. This adapter is for these functions' table operations; it deliberately refuses Auth, Storage and Functions API destinations. It does not authenticate incoming requests.

Incoming JWT gateway settings, x-admin-secret checks, CORS, request parsing and order/payment/notification/geocoding handling are preserved. geocode-order's platform JWT gate remains necessary; local handler tests cannot simulate the hosted gate. The active target of the Railway admin proxy remains independently unverified. order-confirm is outside scope because production source retrieval remains unavailable.

## SDK and reproducibility

Candidate imports pin npm:@supabase/supabase-js@2.118.0, the registry version retrieved during this review. The local package.json and package-lock.json pin the actual SDK and transitive dependency graph tested under Node 24.19.0. The production functions currently import an unpinned @2 URL; their deployed resolved SDK version is unknown. SDK pinning therefore still needs a staging runtime rehearsal even with the feature flag off. The local npm lock is not a Deno deployment lock. Deno is unavailable in this workspace; hosted module resolution, Deno type-checking, environment JSON availability and platform authorization remain unverified.

To reproduce, fetch the three deployed source snapshots into a directory as review-order.ts, hyper-worker.ts and geocode-order.ts. Do not put any credential values in them. Run npm ci --ignore-scripts, then RTK_EDGE_REVIEW_SOURCE_DIR=/absolute/source-directory npm test. All nine tests passed with no skips. The source verification test intentionally fails if snapshots are not supplied or their hashes differ. Raw CRLF snapshots are normalized when building; original and normalized hashes are both retained.

Build candidates with python3 build-candidates.py --source-dir /absolute/source-directory --output-dir /absolute/output-directory. Each generated function directory contains index.ts and its adjacent helper. The builder checks source hashes and allows only the SDK/helper import and client-construction replacements; do not apply patches blindly to a newer deployed function.

Tests exercise invalid configurations without factory calls, exact legacy factory arguments, named secrets, actual SDK GET/POST/PATCH/DELETE headers and bodies, blocked origins/non-REST destinations, mismatched keys, unrelated user JWT preservation, redirect-error request mode, and no constructor network activity. Tests load all three exact candidate handlers in isolated Node contexts in legacy/new modes, confirm unchanged handler text, OPTIONS/CORS, method rejection, missing/wrong admin-secret rejection, and incomplete-payload rejection without any database/provider call. These are boundary and transport tests, not full booking regression tests or real Supabase authentication.

## Next staging gate

Use only the existing staging Supabase project hvrqgufqjslvgiohgkvu. Rehearse import/startup with the flag off, confirm the JSON key environment is available privately, then use a bounded synthetic fixture/transport harness for enabled database access. Keep notifications and Google/payment requests stubbed or refused; do not execute chargeable provider calls. Check platform JWT protection separately, preserving true/false/true. New inbound publishable-key handling is a separate change and is not included here.

Only after staging evidence and a fresh production-source comparison should these credential-only changes be considered for production. Do not revoke legacy keys: browser clients, other functions, shadow configurations, webhooks/cron and external scripts still need coverage. Local tests do not prove no other consumers exist.

Official migration guidance checked: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys . Changelog index retrieved and relevant breaking-change tags reviewed; no database schema change is involved in this candidate.
