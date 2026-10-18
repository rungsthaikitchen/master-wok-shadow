# Comparison backup, alerts and saved-source bridge — review package

Prepared 18 October 2026. Local development only: no commits, deployments, cloud writes, new route calls or production queries were made for this package.

## Implementation

- delivery_comparison_offvolume.py: default-off staging-only backup job using the existing pinned S3 client configuration. The source database is opened read-only; an online consistent SQLite copy is checked for schema/application/source identity, integrity, foreign keys, nonempty events and a 50 MB bound. The snapshot uses a unique timestamp/UUID object key under delivery-comparison/v1. A downloaded readback must match SHA-256 and SQLite counts before a manifest is uploaded and BACKUP_VERIFIED emitted. Failures are redacted. Hourly successful backups, five-minute failure retries. Private health remains unhealthy until the first verified backup, immediately after failure, or when last success exceeds two hours. Backup work runs outside the polling thread. No automatic deletion, retention pruning or credential discovery.
- delivery_comparison_worker.py: optional backup startup and composite private health, preserving default-off backup behaviour. The current deployed worker is unchanged until an approved commit and deploy.
- delivery_comparison_source.py: injected saved-snapshot bridge, disabled by default. It calls the existing redacted audit, binds snapshot identity/time/day/hash and complete order membership, then records only UNVERIFIED comparisons in a SAVED_STATE_ONLY journal. Build identity includes the bridge/journal code. It has no network client and cannot write to Supabase. It is not connected to the production collector yet.
- Dockerfile.comparison-backup: separate image with existing pinned SDK dependencies and the tested unprivileged worker bootstrap. No shared image changes.

Validation: 159 Python tests passed with ResourceWarning treated as error. Six additional tests cover verified object round-trip and expiry, readback corruption and manifest failure, default-off/scope refusal, saved-snapshot integration and uncertainty, mismatched audit rejection, and composite health. Tests use a fake object-storage client and synthetic source fixtures. The unchanged JavaScript suite previously passed 135 entries. No actual cloud backup has run for the comparison journal.

## Proposed next staging rollout — approval required

1. Commit only this reviewed package to delivery-route-staging.
2. Create a dedicated private staging bucket mw-comparison-backups-staging. Keep it separate from production evidence backups and their credentials.
3. Update only master-wok-comparison-staging to the new pinned commit and Dockerfile.comparison-backup. Keep its current 500 MB volume and private health token. First deploy with MASTER_WOK_COMPARISON_BACKUP_ENABLED=false and confirm normal polling and durable records.
4. Set storage settings through bucket-variable references and enable the backup flag. Verify an actual upload→download→integrity check→manifest cycle and health 200/401. Restart this staging service once and verify journal counts remain intact and a fresh backup succeeds. Failed acceptance means disable the new backup flag and report the failure, without touching production.
5. Add an HTTPS domain targeting port 8080 to this service. The response remains protected by the existing Bearer token. No journal export endpoint is added.
6. Configure an independent Better Stack HTTP monitor for /healthz with that private Authorization header, then test down and recovery alerts. Better Stack account access is not currently exposed through the available tools; creating/testing that monitor requires an available account connection or the owner's UI action. No alert or email has been sent by this package. A public domain alone is not independent monitoring.

All cloud calls in this rollout are synthetic staging backup operations. No Google calls, customer addresses, production source credentials or production deployments. No changes to existing production backup buckets or monitors.

## Bounded real-order trial plan — separate approval required

Phase A: one read-only atomic saved snapshot for one agreed service date, from the existing minimal source projection (no address/coordinate values/customer notes). Persist its redacted audit in a separate SAVED_STATE_ONLY comparison database with its own identity and backup/health requirements. Every prediction remains UNVERIFIED; compare observed saved statuses only. Reject partial reads, wrong source role, stale snapshots or missing membership. This establishes data flow, not decision accuracy. No extra customer data is needed from the owner.

Phase B: before any customer-route calls, review one or two selected delivery candidates and their complete dated hypothetical kitchen/driver commitment manifest. Agree the exact customers/addresses sent to Google, a maximum of six directed route requests for a two-candidate matrix (two for one), no automatic retries/polling, route retention and a defined comparison-retention policy. Use current/dated route evidence, not remembered journey times. Keep the existing two-minute loading/handover allowances, arrival ±10 minutes, food-ready-to-door maximum 20 minutes with under 15 preferred, full return journey, and five-minute minimum demonstrated saving for combining. No food-ready time, journey or completed activity is invented.

Capture recommendations before comparing with the authoritative booking outcome where decision-time instrumentation exists. Current saved-state polling alone is labelled CURRENT_SAVED_STATE_NOT_DECISION_HISTORY and cannot reconstruct the original booking decision. A GREEN result or hypothetical route never changes availability or checkout. Missing commitment/route evidence remains UNVERIFIED. Any backend event hook must be separately reviewed as fail-open, default-off and outside the authoritative booking decision.

## Recovery and outstanding limits

Off-volume objects retain snapshot plus matching manifest after verified readback. Offline recovery uses the manifest hash and delivery_comparison_backup.restore into a new file, never over a running journal; it verifies identity, scope, schema and database integrity. A local test proves restore refusal for wrong hashes/source identity and existing destinations. A downloaded comparison snapshot is not interchangeable with delivery-evidence.sqlite3 or a kitchen database.

Current backup adapter is deliberately scoped to the synthetic staging journal. Production saved-state comparison backups need an explicit separate source identity/project scope and acceptance before promotion. Object lifecycle, immutability and a second-provider copy are not implemented. SDK socket timeouts bound individual operations, but are not a formal total cloud-operation deadline. Production live booking remains unchanged throughout.
