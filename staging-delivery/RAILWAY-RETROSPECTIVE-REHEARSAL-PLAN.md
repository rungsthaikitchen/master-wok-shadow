# Railway recovery rehearsal approval scope

Prepared 18 October 2026. Base staging branch: delivery-route-staging at 3abbeb1e4355c69d80d195733ea4eb16e27fbc4f. Staging read confirmed nine existing services and no pending work. No platform mutations or GitHub writes have been made for this rehearsal.

## Proposed commit

Commit the cumulative conditional comparison journal/importer and scope-aware backup changes, tests, review notes, plus the new one-shot retrospective_recovery_once.py and Dockerfile.retrospective-recovery. All examples are synthetic. No customer inputs or credentials belong in the commit. Main and all existing pinned deployments remain untouched.

## Proposed isolated resources

| Setting | Value |
|---|---|
| Project | 7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8 |
| Environment | master-wok-staging, c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279 |
| New service | master-wok-retrospective-recovery |
| Source | rungsthaikitchen/master-wok-shadow, pinned to reviewed new commit |
| Dockerfile | railway-shadow/Dockerfile.retrospective-recovery |
| Start | python railway-shadow/retrospective_recovery_once.py |
| Restart | NEVER, one replica, no cron |
| Volume | new dedicated 500 MB volume at /data, us-west2 |
| Journal | /data/master-wok-retrospective-recovery/delivery-comparison.sqlite3 |
| Bucket | new private mw-retrospective-recovery-staging, ams |
| Public endpoint | none |
| Google/Supabase credentials | none |

Use only private bucket credential references for MASTER_WOK_BACKUP_ENDPOINT, BUCKET, REGION, ACCESS_KEY_ID and SECRET_ACCESS_KEY; virtual addressing. Never print credential values. The enable flag MASTER_WOK_RETROSPECTIVE_RECOVERY_ENABLED defaults absent/false. Explicit scope MASTER_WOK_RETROSPECTIVE_RECOVERY_SCOPE=SYNTHETIC_AGGREGATES_ONLY is required along with exact Railway identity and volume mount.

The runner prepares only its dedicated subdirectory when root, then clears supplemental groups and drops to UID/GID 10001 before opening the journal or accessing storage. Disabled startup does not prepare a volume directory or contact storage. Docker build has not yet been executed; the Railway build is part of the approved rehearsal and may reveal image/runtime dependencies.

## Bounded sequence

1. Commit reviewed files with an expected-parent branch guard. Inspect pending Railway changes; do not accept unrelated work.
2. Create/configure the isolated resources, pin the commit, and deploy with the enable flag false. Observe terminal SUCCESS and runtime DISABLED with zero requests.
3. Enable the fixed synthetic rehearsal and deploy. Require RECOVERY_REHEARSAL_PASSED, beforeEvents=0, afterEvents=1, localRestoreVerified=true, cloudReadbackVerified=true and googleRequests=0.
4. Redeploy the same pinned enabled code once with the volume retained. Require beforeEvents=1, afterEvents=2 and priorVolumeDataPresent=true. Both runs take SQLite snapshots, restore to a new scratch database and verify counts; cloud transport uploads a snapshot, downloads it and checks checksum, SQLite integrity and counts before publishing a manifest.
5. Set enable flag false, deploy, and verify DISABLED/zero requests. Leave synthetic evidence and backups in place for review. No destructive resource cleanup is included.

Each successful enabled run creates one snapshot and one manifest: four small objects expected in total. Storage/build charges may apply. There are zero Google requests. An enabled failure stops the run; investigate before any repeat. The second enabled deployment is specifically the approved volume-persistence check, not an automatic retry. If the first run already finds unexpected prior events, stop and investigate identity/resource reuse.

## Evidence and limits

The fixed fixture includes a contract field networkRequests=2 to exercise the prior aggregate schema. This is synthetic input, not a billable request count. Runtime logs instead explicitly report dataOrigin=SYNTHETIC_REHEARSAL and googleRequests=0. Nothing reads actual orders or changes live availability, checkout, kitchen or driver activity.

Health failure/recovery was tested locally through the authenticated HTTP server. This one-shot Railway service has no public monitor. The rehearsal establishes volume retention and cloud readback only after actual runtime evidence is observed. A continuous worker with monitored health and decision-time booking evidence remains a separate integration.

## Test run note

The first full preflight ran 179 tests with one failure in the existing worker shutdown test: its child process exceeded the five-second cleanup limit and was killed. The isolated test passed on rerun. The final full-suite output is included separately; no timeout was relaxed and no existing worker code was changed. Docker is unavailable locally, so container build remains unverified until the approved Railway build.
