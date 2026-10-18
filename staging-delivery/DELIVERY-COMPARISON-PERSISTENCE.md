# Delivery comparison persistence — local review package, 18 October 2026

This package adds delivery_comparison_journal.py and ten regression tests. No production collector, live checkout, source query or Google adapter is changed. There is no network client or automatic worker in the new module. Initialization is disabled unless enabled=True is explicitly supplied.

The dedicated delivery-comparison.sqlite3 file uses SQLite WAL, synchronous FULL, foreign keys, a single-writer process lock, private file permissions and explicit application/schema/source identity. It refuses the existing kitchen, evidence and staging journal filenames, and refuses reuse under another evidence scope. It does not migrate or overwrite an existing unrelated database.

## Evidence contracts

SAVED_STATE_ONLY accepts only the existing validated redacted evidence-audit contract and a build hash. Every record remains UNVERIFIED, planKind=null, verified=false. Freshness is checked against the supplied recording clock. Observed order status is retained separately from prediction. No cooking/driver completion or exact booking decision is inferred. Missing orders produce an empty latest snapshot, without generating cancellations.

SYNTHETIC_STAGING accepts the existing validated offline synthetic comparison batch. It preserves RECOMMENDED versus UNVERIFIED, explicitly labelled SYNTHETIC_HYPOTHETICAL_PLANS. It requires a distinct database scope and cannot ingest saved-state audits. This contract is for offline synthetic fixtures only; it is not approval to persist Google-derived comparisons or customer routes. The previous Google one-shot deliberately has no journal call.

The journal allowlists/redacts via the established input validators. Saved records contain aliases, evidence/build/source hashes, service date, assessment timestamp, observed status, uncertainty codes and prediction; synthetic records additionally contain the existing test case and policy identifiers. No addresses, coordinates, baskets, free text, travel durations or raw provider body are stored.

## Durability and interpretation

Atomic transactions insert content-addressed observations and snapshots, append a separate event for each recording, and update latest per service date. A→B→A preserves all three events while deduplicating repeated content. Clock regressions cannot replace latest. A failed transaction leaves the previous snapshot intact. Summaries verify payload hashes and report only latest counts of observed status versus hypothetical prediction; they are not accuracy metrics or freshness/health claims.

The journal library has no network listener; the separate staging worker below provides private failure health and verified local recovery snapshots. No off-volume backup adapter, retention cleanup or production runtime integration is included. Existing delivery-evidence.sqlite3 backup tooling is not compatible with this new application ID/schema and must not be pointed at it. Local backup/restore, write-failure health reporting and a bounded synthetic worker have now been tested as described below; production deployment still requires off-volume recovery and complete real planning evidence. No production activation is included in this package.

## Suggested next rollout

1. Review and approve committing this package to delivery-route-staging.
2. Prepare a dedicated staging-only worker using offline synthetic fixtures, a separate volume, no Google or production credentials and explicit failure health.
3. Test durable restart, A→B→A history, missing input, write failure and backup/restore before enabling continued collection.
4. Decide customer-route handling, retention and request budget separately before any real delivery recommendations. Complete dated kitchen/driver commitments remain required; current saved order state alone cannot establish them.

No external action or further route calls are authorized by these development notes.

## Worker and local recovery additions

The package now includes delivery_comparison_worker.py, delivery_comparison_backup.py, Dockerfile.comparison-staging and seven worker/recovery tests. The staging worker is disabled by default, refuses production scope and refuses known source/provider credential variables. It generates the six existing offline synthetic cases, records their redacted comparisons every 60 seconds, and verifies a replacement local backup before reporting a healthy cycle. It uses no Supabase or Google calls. Both fixture assessment and subprocess output use the existing validated synthetic contracts.

Private /healthz requires a dedicated Bearer token of at least 32 characters, starts unhealthy and returns 503 after any failed cycle or 180 seconds without success. Successful runtime cycles probe their own health listener to confirm authenticated 200 and unauthenticated 401. Logs contain aggregate status only. Exceptions never expose secret values or raw input. The worker exits cleanly on termination and closes its SQLite writer lock.

Local snapshot restore requires the expected SHA-256, matching application/schema/source identity and scope, SQLite integrity and foreign-key validation, and a new destination. Existing files are refused. Restores are offline and never overwrite an active journal. The worker retains one latest verified snapshot on the same volume; this protects against some local corruption but not volume loss. The existing off-volume evidence backup adapter is deliberately not reused.

Concrete proposed staging rollout: commit this reviewed package to delivery-route-staging, create one dedicated master-wok-comparison-staging service only in master-wok-staging, pinned to that commit, using Dockerfile.comparison-staging and a dedicated 500 MB volume at /data (writable by UID 10001). Journal /data/master-wok-comparison/delivery-comparison.sqlite3. No database/provider credentials, public domain or cron; one replica. Set a new private health token without printing it. First deploy disabled, then enable only MASTER_WOK_COMPARISON_STAGING_ENABLED for the synthetic rehearsal. Verify runtime 200/401 and persistent rows across a scoped restart. Leave synthetic collection enabled only if acceptance passes. Production services and all Google flags remain unchanged. This rollout requires approval; it has not run.

Validation: 151 Python tests passed with ResourceWarning treated as error, including 17 new persistence/worker/recovery tests. The unchanged JavaScript suite previously passed 135 entries. Actual local entrypoint execution confirmed durable records, a verified local backup, authenticated 200/unauthenticated 401, and clean shutdown. Container build and Railway runtime acceptance remain untested.

Rollout observability: worker logs include only aggregate previousEvents, eventRecords and latestRecords counts to verify persistence across the approved restart. Full Python suite rerun: 151 tests passed.
