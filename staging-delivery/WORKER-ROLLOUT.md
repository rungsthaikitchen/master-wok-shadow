# Staging worker rollout — 17 October 2026

Supersedes the pending deployment status in WORKER-REVIEW.md. User explicitly approved committing the staging worker, deploying a separate service and enabling the synthetic rehearsal.

## Deployed runtime

- Repository: rungsthaikitchen/master-wok-shadow, branch delivery-route-staging.
- Runtime pinned commit: `4c7f4c627fc1e6752c1b968ec6bf2738bc351533`.
- Railway project: `7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8`.
- Staging environment: `c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279`.
- New service: master-wok-delivery-staging-worker, `08dcd1bb-88f1-45b0-ae1f-947ddc8ea3a2`.
- Successful active deployment: `2d0fa6c8-b856-4526-be0a-735311e1d347`.
- Dedicated 500 MB volume: delivery-staging-journal, `744ae9a2-8fe2-44a0-89a1-d8507fa6ae79`, mounted /data.
- Journal: /data/master-wok-delivery/delivery-staging.sqlite3.
- One replica, Python 3.12 / Node 22 Docker image. Start: python railway-shadow/delivery_staging_worker.py.
- Runtime enabled explicitly in this staging service. Code remains disabled by default.
- Staging read-only token is referenced from bubbly-presence; it was not read out or copied into source. No Google or production credential is configured.
- No public domains or TCP proxies. Health checks run against the worker's loopback interface with the private health token.

## Acceptance evidence (UTC)

| Time | Result |
|---|---|
| 14:14:46 | Initial commit 262bff2, deployment 97e6b200-be48-49bc-b08c-81b8814c2d73: DISABLED, networkRequests 0 |
| 14:16–14:17 | First enabled revision failed two polls; no successful comparisons committed |
| 14:18:29 | Corrected API response handling: OBSERVED, six cases, 12 current comparisons, 12 durable observations, pollRecords 3 |
| 14:18:29 | Internal health: authenticated 200; unauthenticated 401 |
| 14:19:03 | Explicitly approved restart remounted the same dedicated volume |
| 14:19:09 | OBSERVED, six cases, 12 current comparisons, 12 durable observations, pollRecords 4; authenticated 200 and unauthenticated 401 again |
| 14:20:09 | Next automatic poll: OBSERVED, still six cases and 12 durable observations, pollRecords 5 |

All records remain SYNTHETIC_STAGING, evidence CURRENT_SAVED_STATE_NOT_DECISION_HISTORY, verified:false. Successful source reads require the response role supabase_read_only_user. Two initial failures remain part of the persistent poll audit rather than being rewritten as successes.

The first enabled revision incorrectly required only HTTP 200. The corrected implementation accepts HTTP 200/201 as the existing kitchen Management reader does, and exposes only fixed redacted failure codes. It then passed the real endpoint path. Private health verification was added so endpoint checks require no public domain.

Local tests after the runtime fix: 68 Python tests pass; unchanged Node suite has 114 passing entries in Europe/London and UTC. The actual deployed Node 22 worker successfully exercised all six real-engine synthetic cases; a full Node test-suite run inside Railway was not performed.

## Isolation verified

Main stays at d1f370fc543e49130dae93a72932184aad728f4f. Production kitchen observer stays on deployment 13d9fedd-b01c-4a85-8fba-a3f84c236093. Staging kitchen collector stays on 040cca70-48db-4443-b6a2-3b253f31a065. Google route smoke-test service stays disabled on deployment f72fefc4-ea0b-4111-bdcf-c02ce30edba0, pinned 8209ca2. No new Google requests, live checkout changes or production database writes were performed.

## Operational limits and next work

- This runs fixed synthetic cases continuously, not live delivery shadow comparisons. Frozen fixture assessment clocks are distinct from actual polling health.
- Automatic approval review rejected creating a public HTTPS domain as outside its interpretation of the approved scope. No alternate public exposure was attempted. Loopback health verification completed the checks safely; no external monitor has been installed for this worker.
- Renew the staging token before its approximate 22 October expiry. The new worker shares its lifecycle through a Railway reference.
- Dedicated-volume persistence has passed a restart test. Off-volume backups and restore rehearsal are still outstanding.
- Real delivery shadow integration still needs suitable route evidence and retention terms, complete kitchen/driver commitment evidence and clarity about saved states versus historical decisions.
- Stop or disable only this new service to roll back. Retain its volume for evidence. Neither kitchen collector needs redeployment.
