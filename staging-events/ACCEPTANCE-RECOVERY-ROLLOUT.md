# Deployed acceptance and cloud recovery rehearsal — 19 October 2026

Uses a new, separately identified synthetic stream and event directory. The completed offer-only trial and its spent two-read/three-mutation budget are unchanged. The user requested proceeding with deployed acceptance and off-volume recovery after that completed trial.

The new case retains the same two-read/three-mutation cap, plus one persistent cloud-recovery attempt. Failed attempts consume allowance; no automatic retry or reset creates another cloud attempt. The existing staging service, volume, narrow database logins and private bucket credentials are reused. No new service/bucket/domain or production mutation is included.

`event_recovery.py` snapshots the acknowledged event journal, uploads one bounded SQLite object and JSON manifest under a dedicated source-identity prefix, downloads both, compares the manifest and hash, restores to a new scratch directory, verifies all journal content and ACK state, and confirms the restored worker is IDLE. A verified receipt is cached only for the same complete journal fingerprint, not counts alone. A second unchanged poll uses cached proof, rather than claiming a second remote restore occurred. Changed journal content or corrupted proof fails closed.

The manifest records source request counters and a conservative restore policy: recovered trials spend all source/cloud allowances rather than gaining fresh request budgets after volume loss. This policy is exercised on a separate scratch budget during the restore rehearsal. Live files and spent original budgets are never overwritten. This is a data/ACK/restore-policy rehearsal, not an automatic replacement of the running volume.

Cloud verification requires two PUTs and two GETs (snapshot + manifest), each using the existing SDK's bounded retry policy; object size is capped at five MB. Partial objects from a failed attempt are left for review, not automatically deleted. SDK versions remain pinned in requirements-backup.txt, now also installed in the event runtime image.

When cloud backup is explicitly enabled, a poll must finish source export, durable comparison recording, local snapshot and verified recovery before authenticated health becomes good. A failed recovery keeps health false. Backup is disabled by default and is only constructed after the staging runtime's existing scope checks.

The source action sequence for this case is a fixed offer and named acceptance through the service-local authenticated operator endpoints. Success requires two source events, one CONFIRMED reservation, one recorded offer comparison, two deduplicated export polls, health 200/401 checks and verified cloud restore. The customer route is a staging operator test endpoint, not production customer authorization.

Local tests cover cloud round trip, restoration without reprocessing, cached proof, corrupt read-back, persistent failure allowance, changed-history cache refusal and unhealthy monitoring on backup failure. Actual deployment evidence is appended only after observed.

Remaining after this rehearsal: sustained monitoring/retention, independent recovery from a separate process/environment, real customer authorization, full lifecycle edge cases and complete production capture/baseline integration. No real customer history is claimed by this synthetic case.

## Observed evidence

All 32 event-related Python tests passed locally in 20.900 seconds. No Node engine code changed in this milestone.

Deployment b3ad582d-1c3b-4b81-a7f6-7f238c2387bf, pinned f3f503a, reached terminal SUCCESS. At 08:44:20 UTC its runtime logged OBSERVED / QUEUED / RECORDED, observations=1, CLOUD_RECOVERY_VERIFIED, authenticatedHealth=200, unauthenticatedHealth=401, exportAttempts=1 and mutationAttempts=2. This is actual deployed HTTP/DB/export/replay/cloud-restore evidence, with verified:false retained.

A separate read-only DB check found event_count=2, order status confirmed, commitment CONFIRMED, target 2026-10-19T17:00:00Z, reservations=1. Thus the named customer acceptance retained one reservation at the offered target. The source was then disabled before the final read-only poll. The earlier completed offer-only stream and its budget were not modified.

The cloud verification restored the downloaded snapshot into a separate temporary SQLite database, checked its full logical fingerprint and counts, and confirmed an IDLE worker with ACK state intact. It also exercised the conservative restored-budget policy in a separate scratch budget. It did not replace the running volume or simulate destruction of the service. A cached second-cycle proof must not be described as another remote restore.

The second poll at 08:45:31 UTC logged OBSERVED / ALREADY_QUEUED / IDLE, observations=1, CACHED_RECOVERY_VERIFIED, authenticatedHealth=200, unauthenticatedHealth=401, exportAttempts=2 and mutationAttempts=2. No second comparison or remote recovery was claimed.

Cleanup deployment 6efcfd89-c578-4fb6-b37d-47e9900a529e, pinned to f3f503aaf023436dea77c274c78756baff528c56, reached SUCCESS. Its 08:46:48 UTC runtime log reports DISABLED, verified:false and sourceRequests=0. Runtime, trial and cloud-backup flags are false. A later read-only staging check found zero enabled streams and the completed two-event acceptance stream disabled. Railway reports no pending staged changes. Production was unchanged.
