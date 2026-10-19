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
