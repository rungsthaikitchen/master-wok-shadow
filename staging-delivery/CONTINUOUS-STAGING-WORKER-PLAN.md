# Continuous comparison staging worker

Prepared 18 October 2026. Cumulative, uncommitted patch against f2ecda8554375113c9028f1d32872d0716a834fa. No deployments, real source access, Google requests or cloud writes occurred during development.

## Complete runtime

continuous_comparison_staging.py supplies the missing startup configuration, fixed synthetic candidate/capture adapter, authenticated health listener, 60-second controller loop, verified backup adapter, dedicated directory bootstrap and SIGTERM/SIGINT shutdown. It refuses the wrong project, staging environment, service name or volume mount, and refuses known live source/provider credentials. Disabled startup reads no storage credentials and constructs no journal or network client.

The controller and worker are separately default-off; this staging runtime explicitly opts into synthetic capture only. Provider-shaped aggregate fields are fixtures, not real Google usage. Logs explicitly report SYNTHETIC_REHEARSAL and googleRequests=0. No Google client or source database reader is wired into the runtime.

The health listener's default synthetic label is retained for this synthetic worker. Conditional assessment support remains separately available in the controller health contract. Health always retains verified=false and must not be interpreted as measured booking accuracy.

## Backup safety and limits

The controller now requires verifiedAt on every successful backup receipt. A cached receipt keeps its actual verification time; polling cannot refresh it artificially. Recent cycles must be within 180 seconds, and the most recent verified backup within 7,200 seconds. Future, stale, missing and non-finite receipt times are rejected. Existing controller integration callers must supply verifiedAt; this is an intentional fail-closed change to the still-uncommitted interface.

For the bounded synthetic rehearsal, a separate journal table permits two cloud backup attempts over the journal's lifetime. Each attempt is reserved before any upload, and failures consume the allowance. Repeated minute cycles reuse the verified receipt, avoiding a new snapshot every minute. Restart loses the in-memory receipt and verifies another backup if allowance remains. A third startup or later backup expiry cannot bypass the allowance: health becomes unhealthy and further cloud uploads are refused.

This is not the final unattended retention/backup policy. It is an intentionally bounded continuous-worker rehearsal. A deployed rehearsal should be disabled promptly after the planned restart checks. Source/route request reservations and the cloud-attempt budget are distinct. Neither performs Google calls here.

## Tests

Focused tests run the actual worker loop and HTTP health server using temporary SQLite files and an injected disk-backed object-store transport. They verify multiple cycles, journal reopen, deduplication, two backup attempts across starts, refusal of a third upload, corruption failure, authentication, default-off gates and production/credential refusal. Additional controller tests reject fake or stale backup receipts. The final full Python suite output is included.

No container build was performed in this development step. The previously built railway-shadow/Dockerfile.retrospective-recovery is compatible with an explicit start-command override to python railway-shadow/continuous_comparison_staging.py; Railway must verify the new pinned build before claiming deployment success.

The disabled entrypoint was also executed as a real subprocess. An initial privilege-change failure in the disabled bootstrap was corrected: disabled startup now returns before touching process privileges. The final regression includes this subprocess path. Enabled root bootstrap still prepares only the exact dedicated directory and drops supplemental groups, GID and UID before starting the worker. The local environment cannot exercise that privileged transition; its actual container behavior remains part of the Railway rehearsal.

## Concrete staging rollout for approval

Commit the cumulative controller/health/worker/test changes to delivery-route-staging with expected parent f2ecda8554375113c9028f1d32872d0716a834fa. Keep main and existing pinned services unchanged.

Create only in project 7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8, environment c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279 (master-wok-staging):

| Setting | Value |
|---|---|
| Service | master-wok-continuous-comparison-staging |
| Source | reviewed commit pinned on delivery-route-staging |
| Dockerfile | railway-shadow/Dockerfile.retrospective-recovery |
| Start override | python railway-shadow/continuous_comparison_staging.py |
| Volume | fresh dedicated 500 MB at /data; us-west2 |
| Journal | /data/master-wok-continuous-comparison-staging/delivery-comparison.sqlite3 |
| Bucket | reuse mw-retrospective-recovery-staging through private variable references; separate source identity/prefix |
| Restart policy | NEVER during bounded rehearsal; one replica; no cron |
| Enable | MASTER_WOK_CONTINUOUS_STAGING_ENABLED=false initially |
| Scope | MASTER_WOK_CONTINUOUS_SCOPE=FIXED_SYNTHETIC_CAPTURE_ONLY |
| Request allowance | MASTER_WOK_CONTINUOUS_REQUEST_LIMIT=2; synthetic reservations only |
| Health | port 8080, /healthz, random private token of at least 32 characters |

Use a private token variable MASTER_WOK_CONTINUOUS_HEALTH_TOKEN and the existing MASTER_WOK_BACKUP_* bucket references. Never print secrets or put them into GitHub. Public networking or a Better Stack monitor is optional and requires a separately scoped authenticated endpoint; no monitor setup is implied by local tests.

Run disabled baseline, then enable and observe at least two minute cycles plus one same-build redeployment with the volume retained. Require successful deduplication, backup verification and authenticated health throughout. Stop after any unexplained failure; no automatic enabled redeployment retries. Disable at the end and verify DISABLED/zero requests. New service/volume accrue small resource usage; existing synthetic bucket gains at most two snapshot/manifest pairs for successful attempts. Existing resources are retained, not deleted.

## Real-order activation remains separate

Live source binding, verified kitchen origin, complete commitment coverage, paid provider adapter and quota, ongoing backup retention, decision-time evidence and production rollout are not enabled by this patch. Do not pass real data into the fixed synthetic identity or relabel synthetic fixtures as evidence. A fresh approval is required before paid requests or production changes.
