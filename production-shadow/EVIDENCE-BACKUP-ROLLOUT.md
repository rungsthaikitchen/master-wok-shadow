# Off-volume delivery evidence backups — review proposal

Prepared 18 October 2026. Code is tested locally, not pushed or deployed. No bucket has been created by this preparation task. The currently deployed collector remains pinned to 64cd7bea5c3fa553fb29876cd2c8b53248392165. Its domain shadow.rungsthaikitchen.co.uk has valid HTTPS; authenticated Better Stack 200 responses were observed, and the owner confirmed both down and recovery emails during the monitor-only bad-token test.

## Exact scope for approval

Commit the eleven reviewed files to rungsthaikitchen/master-wok-shadow, delivery-route-staging, with expected parent 64cd7bea5c3fa553fb29876cd2c8b53248392165. Verify the branch lease before updating. Leave main and every existing deployment pin unchanged until the specifically described collector upgrade below. The unchanged kitchen observer and checkout backend are outside this package.

Railway project: 7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8. Provision two NEW private object-storage buckets, region ams: mw-delivery-backup-test only in staging c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279; mw-delivery-backups only in production-shadow b61e66e7-dbaa-4343-9ca6-5e6f0f5d7612. Inspect each complete environment patch before applying it; no shared-variable, live-order-backend, existing-volume or unrelated pending changes may be included. Use private bucket variable references; never print credential values.

Create one new staging-only, one-shot service master-wok-evidence-backup-acceptance, pinned to the reviewed commit. No volume, domain, TCP proxy, cron or production source credentials. Use railway-shadow/Dockerfile.evidence-backup; start python railway-shadow/delivery_evidence_backup_smoke.py; restart NEVER. Its only input is a synthetic scratch journal; sourceRequests is zero. Use MASTER_WOK_BACKUP_SMOKE_ENABLED=false first, prove DISABLED/networkRequests:0, then approve the bounded real acceptance run with true. Supply only the test bucket references under the MASTER_WOK_BACKUP_* names. One successful run performs one snapshot PUT, one GET/readback/SQLite validation and one manifest PUT (up to two SDK attempts each). Require terminal SUCCESS and BACKUP_VERIFIED/verifiedRestore:true. Disable the one-shot service again. Retain the two tiny synthetic objects; this code does not delete objects.

Only after actual staging acceptance, upgrade existing production delivery collector f4d990c9-c72b-4d24-b17e-f522e101fc88 to the new reviewed commit and dedicated Dockerfile.evidence-backup. Preserve its source read-only token, stable alias key, health token, enabled collector flag, start command, 500 MB /data volume aba504cc-3937-4a0f-accd-e59347d0e027, one replica, overlap zero and draining 45 seconds. Keep the custom domain and Better Stack header unchanged. Add the environment-example variables with backup flag initially false. Verify normal polling and health before setting only MASTER_WOK_EVIDENCE_BACKUP_ENABLED=true on this service. Production enablement is an explicit part of the requested rollout approval, not implied by local tests.

## Behaviour and safety

Backups are default off. Enabled configuration requires the exact production-shadow project/environment/service and mounted-volume metadata, enabled evidence collector, explicit bucket credentials and an HTTPS Railway storageapi.dev endpoint. The collector's existing real mount check still applies. No S3 key is discovered from ambient profiles/instance metadata. boto3 and its tested dependencies are pinned in a separate requirements file and Dockerfile, so other services' images do not gain dependencies.

After the first source cycle, a daemon worker opens a separate SQLite connection in read-only/query_only mode. SQLite's online backup API takes a consistent snapshot including committed WAL data while the collector continues. Scratch files use a private temporary directory and 0600 files. The source is never replaced or modified by backup/recovery code. Snapshot progress has a 30-second deadline. The copy must pass application/schema/source identity, SQLite integrity and foreign-key checks and contain at least one recorded poll. Maximum snapshot/download size is 50 MB.

Each attempt writes a unique timestamp/UUID object under delivery-evidence/v1/<source-identity>/; it never updates a latest object or intentionally overwrites an older key. It downloads that exact object to a NEW scratch file, compares SHA256, verifies SQLite/source metadata and table counts, then uploads a small manifest. Only after all three operations succeed does it emit BACKUP_VERIFIED. Corruption, credential errors, missing source, wrong identity or failed publication emit a fixed redacted BACKUP_FAILED; no keys, aliases, bucket credentials, customer data or provider error text enter logs. The worker never calls Supabase, Google or booking functions.

Success schedules another copy in 3,600 seconds; failure retries in 300 seconds. Client connect/read socket timeouts are 5/15 seconds with at most two attempts per operation; these are not formal end-to-end wall-clock deadlines. A stalled worker becomes unhealthy when its previous success ages out. The worker runs independently of the collector's source-poll thread. Shutdown stops future attempts and waits up to two seconds; an interrupted upload cannot be considered verified without its final manifest. Restart starts a new immediate verification; last-success state is deliberately not trusted across restarts.

When enabled, existing authenticated /healthz returns 503 until the first verified backup, immediately after any failed attempt, or once its last success exceeds two hours (including backward-clock anomalies). It remains 503 for source failures even if backups succeed. The existing Better Stack monitor therefore covers backup failure/staleness as well as source freshness, without changing its accepted status or authentication. A brief initial 503 window is possible while a new verified copy is created. Disabled backup mode preserves existing health behaviour; it must not be described as backed up.

## Retention and limits

All snapshots and manifests are retained; this first version has no deletion, automatic purge or lifecycle changes. Review storage growth after seven days before selecting a retention policy. Hourly full snapshots mean roughly 24 copies per day plus deployment/retry successes; a later verified snapshot covers earlier failed-attempt objects. The 50 MB cap fails visibly instead of silently losing protection. A healthy hourly schedule normally limits evidence loss to about an hour, plus completion time. After a failed attempt, actual recovery age can be older; the monitor alerts rather than guaranteeing a hard recovery-point limit.

Railway storage is private and encrypted at rest; HTTPS protects transfer. These are independent of the service's volume, not a second provider/account. Current Railway documentation says object locks, versioning and bucket lifecycle are unsupported. There is no immutable retention or protection from deletion by someone controlling the bucket/account. Do not promise full disaster recovery. Manifests/checksums detect accidental corruption, not malicious replacement of both objects by a credential holder.

Only the dedicated DELIVERY evidence journal is covered. The older kitchen observer SQLite database is NOT covered by this implementation. Extending this tested pattern to its different schema/identity requires a separate adapter and acceptance; do not upload it through the delivery verifier.

## Acceptance after approval

1. Confirm no unrelated staged changes; commit reviewed files, create only the new test bucket/service, run disabled then real synthetic acceptance, and disable it afterward. Observe SUCCESS, not merely build completion.
2. Provision the private production bucket, upgrade only the existing delivery collector with backups false, verify code SHA/source hashes, normal two-day polling, journal count retention and unchanged authenticated monitor.
3. Enable backups. Require BACKUP_VERIFIED with verifiedRestore:true and Better Stack HTTP 200. This includes an actual download and integrity/identity/count restore to scratch, not just a successful upload response.
4. Restart only this evidence collector once. Require retained state/poll history, another verified object and recovery to HTTP 200. Do not edit production orders, stop checkout, delete the production volume or inject object corruption into production. Corruption/failure handling is covered locally; monitor-only bad-token alert/recovery was already tested by the owner.
5. Report actual bucket/service/deployment IDs, pinned SHA, successful backup timestamps and monitor status. Only then claim off-volume backups operational. External network/provider compatibility and the Docker image build remain unverified before this acceptance.

## Recovery procedure

Select a verified .sqlite3 object with its matching .sqlite3.json manifest using the private bucket Files panel or an authenticated S3 client. Keep the private alias key stable; recover the trusted source identity from the journal's known namespace or compute it from that retained alias key using delivery_evidence_collector.source_identity. Do not blindly adopt a different identity supplied by an untrusted manifest.

Download both files to a private recovery workspace. Create a NEW EMPTY directory for the restored database. The offline tool needs no S3 or Supabase credentials and refuses a nonempty destination directory:

```
python railway-shadow/restore_delivery_evidence.py \
  --snapshot /absolute/recovery/download.sqlite3 \
  --manifest /absolute/recovery/download.sqlite3.json \
  --destination /absolute/recovery/new-volume/delivery-evidence.sqlite3 \
  --source-identity <trusted-64-character-identity>
```

Require RESTORE_VERIFIED. It checks bytes/hash/source identity/schema/integrity/foreign keys/counts and writes 0600. The tool does not install the copy into a running collector. After separate incident recovery approval, stop only the delivery collector, preserve any old volume for investigation, place the verified file on a replacement mounted volume at /data/master-wok-delivery-evidence/delivery-evidence.sqlite3 with private directory permissions, and preserve its alias key and source project. Open/restart through normal collector guards, verify history/deduplication/fresh polls, and verify a new off-volume backup. Never overwrite an active SQLite database or copy its live WAL by hand.

## Rollback and operations

Set MASTER_WOK_EVIDENCE_BACKUP_ENABLED=false only on the delivery collector if an SDK/storage issue prevents acceptable operation; this explicitly removes backup coverage and must be reported. If needed repin this service to 64cd7be and railway-shadow/Dockerfile, retaining its volume, health token and domain. Retain both buckets and their objects. Do not delete data or rotate existing credentials as rollback. Existing kitchen/checkout services remain untouched.

Production read-only source token renewal remains due around 15 November; staging token around 22 October. Bucket access and alias/source credentials have different purposes. Rotating the read token must not rotate the alias key or erase the backup namespace.

References: https://docs.railway.com/storage-buckets ; https://docs.aws.amazon.com/boto3/latest/guide/configuration.html ; https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/put_object.html .
