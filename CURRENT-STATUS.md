Current 25 October candidate: [automatic command routing and observer handover](staging-events/COMMAND-ROUTE-REVIEW.md). Local focused tests and hosted rolled-back SQL checks pass, including draining decisions committed between polls before cutover. The new route-lock concurrency and restricted-runtime rehearsal remain outstanding; the candidate is default-off and not deployed. Earlier [guarded response HTTP](staging-events/CUTOVER-RESPONSE-HTTP-REVIEW.md) and stream-lock concurrency rehearsals passed and their trials are disabled. [Full live writer coverage](staging-events/BOOKING-COVERAGE-AND-HANDOVER-REVIEW.md) remains incomplete. Earlier dated handover notes follow.

# Master Wok review status — 15 October 2026

Ready for code review and continued synthetic staging operation. Production activation is not yet ready or authorized.

## Verified results

User-supplied Railway logs establish a successful container build, synthetic engine/storage checks surviving two deployments, a GET-only collector sample of three synthetic orders, persistence across a subsequent deployment, repeated successful polls for today and tomorrow, and capture of a pending-to-confirmed change. The latest summary showed two confirmed orders and one cancelled. The user then restored the continuous staging command. We have no direct hosting access and have not independently queried that running database.

Local verification: 56 Python tests passed, including GET-only requests, disabled startup, pagination, DST boundaries, source instability, incomplete baskets, model/storage failures, crash/restart durability, and audit history. Six Node test files passed in Europe/London and UTC (25 runner entries per run, including legacy multi-assertion scripts). Test logs are included.

This review adds age-based freshness (180-second threshold, including empty stores and clock skew) and audit counts with historical status counts to the summary. A pending → confirmed → pending sequence is checked in exact order after reopening SQLite. The deployed staging summary does not yet expose these new fields: retention of its earlier pending record is locally tested behavior, not directly verified from its logs.

## Upgrade support — schema version 2

The exact-build database blocker is resolved locally. Schema v2 pins identity to the normalized source origin and pseudonym key, and records the producing build hash on every poll. An unchanged order is sampled again when the producing build changes so its hint retains provenance. Historical rows are preserved.

The known deployed legacy build is identified by railway-shadow/legacy-build.json. Startup recomputes its legacy identity using the configured source URL and secret; a mismatch refuses migration. A matching legacy database receives a unique SQLite backup (including committed WAL), restricted to mode 0600, before a transactional schema upgrade. Failed backups abort; failed schema changes roll back. Future unsupported schema versions are refused. Summary startup performs the same local migration but makes no Supabase request.

56 Python tests include backup recovery, failure rollback, changed source/key refusal, multiple build versions and a real subprocess summary migration. User-supplied staging logs confirmed schemaVersion=2, both producing builds, three distinct orders and seven retained state records including the earlier pending record. Continuous polling was subsequently restored. See railway-shadow/UPGRADE.md for the concrete staging procedure and rollback limitations. Do not delete or rename the existing monitor DB to work around a mismatch.

## Evidence limits

Every polling prediction remains UNVERIFIED. GREEN/AMBER are hypothetical current-load replay hints, never confirmed cooking or booking authorization. Two equal reads do not prove a transactionally consistent snapshot or complete RLS visibility. Polling can miss transitions between samples. Created-at plus final times cannot reconstruct the actual order of decisions and revisions.

Historical chronological replay passes synthetic regression cases; redacted saved-state exports for 18 September and 10 October have now been replayed. They validate input compatibility and provide concrete discrepancy cases, but no ordered decision log or measured cooking history is available. Historical validation remains approximate. No production frontend/backend/Edge changes or production Supabase writes were made. Browser observer and packaged defaults remain disabled.

## Remaining dependencies and deployment plan

1. Review this revision, then follow the single-replica staging upgrade procedure and inspect its audit summary. Locally tested failure paths still need selected hosted staging outage/recovery checks.
2. Confirm production columns, status meanings, menu/modifier IDs, complete order/item visibility and an approved least-privilege read credential. Do not reuse public synthetic staging policies in production. No production permission changes are included.
3. Obtain a redacted real-day orders/items export for approximate replay validation. Exact decision parity additionally needs an ordered durable event stream covering checkout, Edge/admin updates and customer time responses; see PRODUCTION-FLOW-REVIEW.md. Do not label a polled snapshot complete pre-decision history.
4. Agree retention, volume backups, access and disk limits. Configure external process/last-success alerting; a stopped process cannot report its own failure. Suggested last-success threshold is three minutes at the default polling rate; adjust for measured load or a longer configured interval. Automatic pruning, backup jobs and external alerts are not implemented.
5. Present the concrete production service, read access and monitoring configuration for explicit approval. Only after approval deploy the isolated collector with a dedicated volume and single replica, run a one-shot read, inspect results and then enable continuous polling. Existing availability and checkout decisions remain unchanged. Rollback: stop this collector and preserve its database.

See railway-shadow/README.md for runtime details. Do not copy this directory into the production web root or replace server.py, notifications.py, index/admin HTML or Edge functions.

## Rescheduled-slot regression — 15 October update

Tests now cover a synthetic pair of three-portion noodle orders: moving an existing commitment from 19:15 to 19:45 changes the incoming 19:45 order from GREEN to AMBER/NO_FIT. Confirmed time overrides a different proposal/preferred time; an active proposed time also reserves capacity as a planning assumption, not confirmed customer agreement. Pending unaccepted proposals without a confirmed commitment remain excluded under the existing collector policy; cancelled/customer-declined orders never reserve capacity.

The redacted real 18 September export is included as a separate fixture. Saved effective times reproduce AMBER for sample-13 (19:45); clearing revisions for the requested-time sensitivity scenario produces GREEN. This does not reconstruct what was visible when the order was booked. The user reports that 19:45 was already occupied after rescheduling, that they phoned to offer after 21:00, and that delivery occurred about 21:30. This is operator-reported outcome context, not a measured food-ready time. The suspected preferred-time-only bug in the old production scheduler is not proven by this regression.

No collector or engine runtime code changed in this update: current staging does not need redeployment for these tests. No production changes were made. The next comparison is a quiet-day export; approval and read-access/monitoring dependencies remain outstanding.

## Local monitoring tools and access review

monitor_ops.py now provides a strictly local SQLite read-only health probe with failing exit codes and a non-overwriting SQLite backup operation. Seven additional tests cover freshness, missing days, rollover, replay/source failures, missing DB, read-only enforcement, backup recovery and failure output. All 56 Python tests and Node suites in London/UTC passed. The collector and engine runtime files are unchanged.

Production access findings and the concrete remaining hosting requirements are in railway-shadow/MONITORING-AND-ACCESS.md. The broad ChatGPT Supabase connection is not used for further investigation. Public production order updates remain a separate security finding, not an applied fix. External alerts, off-volume backups and genuinely read-only production credentials still need integration and approval.

## Optional monitored launcher

monitored_collector.py adds a token-protected, state-only /healthz endpoint and supervises a single collector child. Seven further tests cover authentication, HTTP 200/503, no query-token access, missing DB, disabled startup, shutdown propagation and unexpected child exit. All 56 Python tests pass; Node runtime files are unchanged from passing London/UTC runs. See railway-shadow/HEALTH-ENDPOINT.md for the concrete staging-only integration and rollback. This launcher has not been deployed. External provider alerts and off-volume backup scheduling are still outstanding.

## Read-only production source candidate

Production metadata-only READ ONLY transactions confirmed the required columns and no existing dedicated reader. No customer/order rows or production writes were performed. A new optional Management API read-only source is prepared and covered by four mocked-transport tests (56 total Python tests pass). It requires a separately scoped Database Read token and staged hosted validation of Supabase's beta read-only endpoint. See railway-shadow/READ-ONLY-SOURCE.md. Existing staging configuration has not been changed. The new source is opt-in and gets a distinct history identity. Production remains unactivated.

Better Stack's authenticated monitor showed Up; test email delivery and real outage dashboard detection/recovery email were reported by the user. Separate automated off-volume backups and production credential validation remain outstanding.

## Production configuration prepared — 16 October

production-shadow/REVIEW.md and railway-variables.example provide a concrete separate-service plan, disabled by default. The read-only Management API source is now supported by supplied staging populated/empty-day results. Exact production Git revision, dedicated project-scoped read token/secrets and explicit deployment/enablement approval remain required. No production service was created, repointed or deployed. Off-volume backup scheduling remains an explicit dependency; it is not represented as implemented.

## Delivery investigation — 17 October

The first offline delivery planner and six tests are added; no production runtime change or deployment. All 56 Python tests and seven Node test files (31 entries each) pass. See DELIVERY-SHADOW-REVIEW.md. Friday had seven deliveries and one collection; the prior eight-GREEN replay treated saved customer times as kitchen-ready, so it is not evidence of arrival/driver feasibility. Production schema has no persisted duration/food-ready field; supplied checkout drops the route function's returned duration and skips route requests for free delivery. Time semantics and numeric route capture must be resolved before delivery-aware shadow integration. No paid-route API calls or customer locations were read.

## Delivery windows and two-drop search — 17 October

The offline delivery-run planner now searches inclusive ±10-minute windows, both visit orders and separate-trip alternatives, including directional return journeys. Food-ready-to-doorstep is capped at 20 minutes; under 15 is preferred, 15–20 flagged. A joint kitchen callback is required before an offline recommendation; real engine/route-data integration remains pending. All 56 Python tests and eight Node test files (53 runner entries each in London/UTC) pass. No production collector/runtime update, source write, deployment or push was performed. See DELIVERY-RUNS-REVIEW.md for precise scope, tests and synthetic example. Keep production shadow unchanged.
# Latest update — offline joint delivery/kitchen assessment, 17 October

Added master-wok-delivery-kitchen.js and six tests. The real conservative kitchen engine assesses both candidate deliveries jointly around fixed hypothetical kitchen allocations, returns cooking finish times, and fails closed on missing coverage. Read DELIVERY-KITCHEN-REVIEW.md for the required snapshot contract and conservative limitations. No live integration or deployment. Full checks: 59 Node entries pass in London and UTC; 56 Python tests pass.

# Latest update — dated delivery integration and route boundary, 17 October

Added disabled-by-default offline route evidence capture and a dated kitchen/driver assessment adapter, plus a bounded fixture CLI. Free delivery does not skip the new route boundary. Complete manifests and independent directional legs are required; caller completeness assertions are not independently established. Tested real two-drop kitchen integration flags the first meal at the 20-minute cap. Read DELIVERY-INTEGRATION-REVIEW.md for input/source limitations, evidence semantics and staging path. No live integration, network routing calls, production writes, pushes or deployment. Full checks: 82 Node entries pass in London and UTC; 56 Python tests pass.

# Latest update — RTK handling policy approved, 17 October

David confirmed 2 minutes food-ready-to-departure, 2 minutes per doorstep handover and at least 5 minutes saved for combined deliveries. Added a disabled offline/staging RTK policy entry point; updated integrated fixtures count both meals at flagged 20/15-minute ages. See RTK-DELIVERY-POLICY.md. No production activation, writes, push or deployment.

# Latest update — isolated staging Google Routes test prepared, 17 October

Added a real HTTPS provider and a disabled-by-default one-shot staging runner. Public landmark fixture, maximum six directional requests, no retries, duration-only response mask, no persistent route output. No actual Google request, push, deployment or production change. Read staging-delivery/DEPLOYMENT-PROPOSAL.md before any upload or activation; use a separate staging branch/service and private restricted key. This is a connectivity test, not live delivery shadow integration.

