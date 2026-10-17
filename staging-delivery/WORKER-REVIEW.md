# Persistent staging delivery rehearsal — review, 17 October 2026

Prepared locally; not committed or deployed. This extends staging branch `delivery-route-staging` at `17d906e0e0da95fae847dfe26091eccbb8de1575`. Main and the production kitchen observer remain unchanged.

## Behaviour

`python railway-shadow/delivery_staging_worker.py` is disabled unless `MASTER_WOK_DELIVERY_STAGING_ENABLED` is exactly `true`. When disabled it exits successfully without credentials, network calls or journal creation. It refuses any environment other than `master-wok-staging` and any source URL other than `https://hvrqgufqjslvgiohgkvu.supabase.co`.

When enabled, a fixed SELECT reads the six synthetic staging cases through Supabase's `/database/query/read-only` endpoint. The returned role must be `supabase_read_only_user`. Redirects are refused, response size capped at 5 MB, HTTP socket timeout 15 seconds. The single aggregate query avoids partial order/item pagination, and caps registered cases at 51 so excess cases are rejected rather than silently accepted. No arbitrary SQL input, customer addresses, coordinates, Google calls, remote writes or live booking hooks are used.

A bounded Node child runs the real RTK kitchen/delivery assessment for every case. Runtime secrets are omitted from its environment. The six registered cases and their expected recommendation outcomes must all pass; missing cases or changed outcomes fail the poll. Child timeout is 60 seconds. These frozen fixture assessments do **not** advance with wall-clock time and cannot prove live driver or cooking activity.

A separate SQLite volume journal records only redacted per-candidate comparisons, hashes, policy identity and wall-clock poll health. A transaction commits all observations, latest presence and success together. Repeated identical snapshots retain 12 observations rather than appending duplicates; revisions retain new observations. Old observations survive removed presence. A content conflict, database failure, source failure or model failure cannot count as success. A file lock rejects concurrent writers. WAL plus synchronous FULL supports crash recovery on the mounted filesystem; it is not an off-volume backup.

The loop waits 60 seconds after each poll, retries failed polls, and handles SIGTERM/SIGINT. `/healthz` requires a private bearer token; it returns only synthetic-origin health and `verified:false`. Failure is unhealthy immediately in the running process. Persisted health requires the latest poll to succeed and be no more than 180 seconds old. Poll freshness and frozen scenario assessment times are separate.

## Validation

- 114 Node test entries pass in Europe/London and UTC.
- 68 Python tests pass, including 12 new worker tests for default-off, staging scope, real model output, restart idempotency, failure retry, atomic rollback, tampering/content conflicts, presence/history, writer locks/source identity, fixed transport, child timeout/secret isolation, malformed bridge results and authenticated health.
- Actual staging database query output passed through the real engine and a temporary journal: six cases, 12 records, three polls across a close/reopen, still 12 records.
- Database metadata confirms the runtime read-only role has schema usage and SELECT on synthetic cases, and no INSERT privilege on the staging observations table. No permission changes were made.
- The actual query was checked through the connected database tool as `postgres` in an explicit READ ONLY transaction. An attempted SET LOCAL ROLE was refused; no attempt was made to broaden privileges. The deployed Management token/endpoint path remains an explicit staging acceptance check.
- No new Google requests, GitHub pushes, Railway deployments or production database writes.
- Local full suites run on Node 24 and Python 3.12. The existing Dockerfile targets Node 22/Python 3.12; this new worker has not yet been tested in that container.

## Concrete deployment plan — approval required

1. Commit only these new worker files and review/test evidence onto `delivery-route-staging`, using expected parent `17d906e0e0da95fae847dfe26091eccbb8de1575`. Leave main unchanged.
2. Create a **new** Railway service `master-wok-delivery-staging-worker` only in project `7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8`, environment `c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279` (`master-wok-staging`). Pin it to the resulting commit. Existing smoke-test service stays pinned to `8209ca2` with both Google flags false; existing kitchen collectors are untouched.
3. Give the new service a new dedicated volume mounted at `/data`. Use `railway-shadow/Dockerfile`, start `python railway-shadow/delivery_staging_worker.py`, one replica, restart on failure, no cron. Use Railway volume-compatible run UID 0 as on the current collectors; journal/lock permissions are 0600. Do not share the kitchen volume.
4. Configure only the following private/runtime values:

| Variable | Value |
|---|---|
| MASTER_WOK_DELIVERY_STAGING_ENABLED | false initially |
| MASTER_WOK_DELIVERY_SOURCE_URL | https://hvrqgufqjslvgiohgkvu.supabase.co |
| MASTER_WOK_DELIVERY_JOURNAL | /data/master-wok-delivery/delivery-staging.sqlite3 |
| MASTER_WOK_MANAGEMENT_READ_TOKEN | Railway reference to bubbly-presence's existing staging read-only token; never copy it to code or logs |
| MASTER_WOK_DELIVERY_HEALTH_TOKEN | New random private bearer token, at least 32 characters |
| RAILWAY_DOCKERFILE_PATH | railway-shadow/Dockerfile |
| RAILWAY_RUN_UID | 0 |
| PORT | 8080 |
| TZ | Europe/London |

`RAILWAY_ENVIRONMENT_NAME` must resolve to Railway's existing `master-wok-staging` value. Do not give this service a Google key or production credential.

5. Inspect the entire environment's staged changes before deployment; apply only changes belonging to this new service. Verify disabled deployment emits DISABLED with zero network calls. Then enable only the new staging worker under the same explicitly approved staging rollout scope.
6. Verify actual Management read-only endpoint acceptance, six scenario outcomes/12 durable observations, repeated polls without duplication, authenticated healthy endpoint and unauthenticated 401. Restart once to verify persisted observations and continued polls. A startup failure, token/access error or result mismatch stops acceptance; do not broaden privileges or switch credentials automatically.
7. Add a public HTTPS domain targeting port 8080 only if needed for external authenticated monitoring. Keep the token private. Arrange off-volume backup and token renewal; the existing staging token was created for seven days, approximately expiring 22 October. This worker's health endpoint is prepared but no external monitor is installed yet.

Rollback: disable or stop only this new worker. Retain its volume for review. No kitchen observer, live checkout or production database rollback is required because none is changed.

## Remaining limits

This is a repeatable **synthetic staging rehearsal**, not delivery shadow monitoring against live orders. Real route evidence capture, retention policy, historical booking events, complete kitchen/driver commitment evidence, off-volume backup/restore and external monitoring remain separate integration dependencies. A current saved booking status is not its original decision, and recommendations remain hypothetical with `verified:false`.
