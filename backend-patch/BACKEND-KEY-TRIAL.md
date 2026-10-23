# Bounded backend credential trial — 23 October 2026

Prepared for the existing staging service only. Production credentials, orders, availability, checkout and customer notifications are outside this trial.

## Scope and evidence

The prior new-key staging read check passed at build 33d21ba7b3b213f2f03a9e123ed4fc805f88c429, deployment 737f1d05-bca6-4fba-8b89-fb8d406137c1. Owner-provided cleanup logs show DISABLED, requests 0 at build d5bf1000b269f4f589316ac1cab6a9635a40946f, deployment ddb30f62-7737-4d2b-96c9-4d8693aeb3cd, 2026-10-23T04:52:15.595556678Z. This proves disabled execution; variable removal is not visible in runtime logs and cannot be independently checked while OAuth is unavailable.

The staging public.orders table lacks the loyalty columns and there are no public.customers or public.loyalty_accounts tables. Rather than change these existing tables, this trial uses three isolated public fixture tables: master_wok_credential_orders, master_wok_credential_customers and master_wok_credential_loyalty_accounts. Their columns are the subset consumed by the tested handlers, with matching relevant production types. Additional CHECK constraints restrict customer identity, phone/email and order IDs to fixed synthetic values. They are not a full clone of production schema or constraints.

Staging migration master_wok_isolated_backend_key_fixtures installed the tables from credential-fixtures.sql. RLS is enabled, public/anon/authenticated privileges revoked, and explicit service_role CRUD grants/policies installed. There are no user triggers. Rollback-only SQL acceptance passed real database CRUD and synthetic-identity rejection checks, leaving all three tables empty. Read-back confirmed service CRUD true and anon/authenticated access false for all three. Security advisors remain at the same two pre-existing INFO no-policy findings in master_wok_delivery_test; no new finding was introduced.

## Actual handler extracts and boundaries

fixtures/credential_backend_51616be.py contains 21 unchanged function bodies and decorators extracted from the owner-downloaded deployment commit 51616be77f92fcfd99958e8d784361eb232073a5. The manifest pins the full source SHA-256 and each original function segment; local tests verify exact equality. Only the module/bootstrap bindings and migrated REST-header helper are isolated for testing. No real backend listener or notification provider is imported.

The tested SDK client maps only orders/customers/loyalty_accounts onto the prefixed fixture tables. A shared HTTP transport refuses production, unprefixed tables, RPCs, authorization headers and unsupported methods before network access. It caps requests at 64, disables transport retries and redirects, and uses five-second request timeouts. A durable attempt marker at /data/backend-key-trial-23-oct-v1.started is consumed before networking and prevents automatic repeats, including after failure. No real order creation or customer attempts are processed.

The Flask handlers run through an in-process test client. Legacy payload/error logs are suppressed. Booking accept/decline reach the fixture REST endpoint using the new key. The admin Edge call is a local stub that validates the forwarded synthetic admin secret and emulates completion only on the synthetic fixture order. It is not evidence that the deployed Edge action accepts the new key or has matching behaviour. Notifications are absent from the extracted handlers and no provider endpoint can pass the network guard.

The trial checks:

- Wrong admin proxy secret rejected before any forwarded action.
- Proposed-time acceptance persists customer_accepted_time and copies proposed_time to confirmed_time, retaining preferred_time.
- Rejection persists customer_declined_time.
- Incomplete order refused by loyalty settlement.
- Admin complete proxy boundary and sequential loyalty settlement: 32 earned points, settled marker true.
- Repeated sequential settlement returns already-settled and does not award again.
- Balance endpoint reports 32 points; earning from 100.75 floors to 100 additional points; redeeming GBP 5 deducts 100, leaving balance 32 and lifetime 132.
- All fixture rows deleted and empty-state verified after success. Cleanup is also attempted after an intermediate failure, but an unavailable database can prevent it; use metadata/fixture-only SQL to inspect before retrying.

Passing this trial preserves and characterizes the old backend's business behaviour. It does not fix known proposal token/status/race issues, prove concurrent loyalty settlement safe, validate all production constraints or exercise real notifications. A legacy acceptance route's misleading success page cannot create a false pass: the persisted fixture row is checked separately.

## Deployment on the existing service

Service: master-wok-continuous-comparison-staging, ID 012e5ef6-6225-4ab3-95f5-894583db7e83, environment c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279, project 7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8. No new resources/domain/volume. Reuse /data and Restart Policy Never. Keep all other observer/trial flags false, including MASTER_WOK_KEY_COMPATIBILITY_ENABLED. Do not apply unrelated staged changes.

Phase A: branch delivery-route-staging at the reviewed commit containing this trial. Dockerfile railway-shadow/Dockerfile.backend-key-trial; start python railway-shadow/backend_key_trial_staging.py; MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED=false. No secret needed. Deploy latest reviewed commit once and verify buildSha plus DISABLED/requests 0. Completed is expected for the one-shot process; no healthcheck or cron.

Phase B, after disabled-code verification: add the staging-only secret as MASTER_WOK_STAGING_SECRET_KEY, set MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED=true, deploy once. Do not add a production key. Expected PASSED, source STAGING_FIXTURES_ONLY, fixtureRowsRemaining 0, notifications 0, productionWrites 0, edgeBoundary LOCAL_STUB, concurrentSettlementVerified false, fullProductionSchemaVerified false. fixtureWrites will be positive because these tests deliberately mutate isolated synthetic fixtures. A failure/ALREADY_ATTEMPTED must not be treated as pass or retried by deleting the marker.

After evidence: set the backend trial flag false, remove its temporary staging secret variable, deploy disabled, and verify zero requests. Preserve the marker and existing shared staging key. Independently read fixture row counts and ensure all are zero. Neither a successful test nor removal of a Railway variable revokes the old production credential.

## Validation and remaining work

21 local backend-patch tests passed, no skips, using the actual Python SDK and stateful HTTP mocks. Six new tests cover full synthetic scenario/cleanup, detecting legacy false success, refusal without deleting pre-existing fixtures, request/path/origin/budget guards, disabled/scope/marker safety, and exact source extraction. Prior 97 event tests were not repeated because their runtime is unchanged. Real staging SQL acceptance passed with rollback; real hosted handler/SDK writes have not yet run. The dedicated image has not yet been built.

After hosted evidence and cleanup, review any remaining production consumer dependencies before replacing/revoking legacy credentials. Do not disable legacy anon/service_role globally merely because this trial passes.

## Hosted trial evidence — 23 October 2026

Owner-provided Railway logs establish both runs on staging service 012e5ef6-6225-4ab3-95f5-894583db7e83, environment c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279, project 7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8. Build SHA was 2c670d11a42961d90d225ea771fcd4781a9c53e0.

| Deployment | UTC observation | Result |
|---|---|---|
| ab3a2ab0-e843-485e-94ed-7aca1a047130 | 2026-10-23T07:43:25.973497815Z | DISABLED, requests 0 |
| a90a373c-a13f-4542-a8f5-4acce427c41c | 2026-10-23T10:08:17.440750295Z | PASSED, source STAGING_FIXTURES_ONLY, requests 35, fixtureWrites 15, fixtureRowsRemaining 0, notifications 0, productionWrites 0 |

The pass explicitly reports edgeBoundary LOCAL_STUB, concurrentSettlementVerified false and fullProductionSchemaVerified false. This supersedes the preceding not-yet-built/not-yet-run status: the image and real hosted handler/SDK fixture operations ran. The pass covers the assertions described above and does not establish external Edge behaviour, concurrent settlement, full schema compatibility or production rotation.

A separate read-only SQL check through the staging Supabase connector independently confirmed orders=0, customers=0 and loyaltyAccounts=0 in the three dedicated fixture tables after the trial. No production data was queried for this cleanup check.

Trial shutdown pending: set MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED=false, remove MASTER_WOK_STAGING_SECRET_KEY from the staging service, deploy disabled and record zero-request execution. Preserve the marker. All other trial flags must remain false. Secret deletion cannot be established from runtime logs alone while Railway OAuth remains unavailable.
