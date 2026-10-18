# Conditional comparison recovery rehearsal

18 October 2026. Synthetic aggregates only, with a dedicated synthetic source identity. No customer data, Google requests, cloud writes, production access, GitHub commits or Railway deployment.

## What ran

The actual SQLite journal, snapshot backup, restore and backup-transport implementation ran against temporary on-disk databases. An injected filesystem object-store transport stood in for cloud storage. The real authenticated HTTP health server ran on a local ephemeral port. This was a local staging rehearsal, not proof of a Railway volume restart or external cloud persistence.

Five new recovery tests verify:

- Close/reopen retains the conditional comparison, and repeated observations deduplicate content while retaining event history.
- SQLite snapshot includes committed WAL data, object upload/download readback verifies, restore installs into a fresh database, and new observations append after recovery.
- Corrupt readback and failed manifest publication fail backup health; a subsequent valid backup recovers it. Backup health expires after two hours.
- Wrong source identity or evidence scope cannot restore or upload; wrong hashes cannot install a destination; existing destinations cannot be overwritten.
- Injected journal write failure rolls back and preserves the prior observation. Authenticated health returns 503 before backup verification, 200 after verification, 503 on corruption and 200 after recovery. Missing authentication returns 401; expired backup returns 503.

The backup transport now accepts an explicit validated source identity and evidence scope. Defaults and the existing synthetic object-key layout remain unchanged. Conditional backups receive their own scope prefix. The existing cloud activation configuration remains restricted to the existing synthetic service; this patch does not enable conditional cloud collection.

## Review and next rollout

This cumulative package includes the previous conditional journal/importer changes, the backup scope extension, tests and results. The final Python regression result is included as TEST-RESULTS-PYTHON-RECOVERY.txt. The previously passing Node suites are unaffected by these Python-only changes and are included from the prior run.

Before a Railway rehearsal: approve committing the reviewed patch, configure a separate disabled staging service with a dedicated volume and synthetic identity, add scope-specific backup configuration using private credential references, then verify an actual volume restart and object-store restore. The local transport rehearsal does not establish that those cloud permissions or infrastructure are configured. Do not reuse the active synthetic comparison database.

Before real-order activation: independently verify kitchen origin, approve aggregate retention and a fresh bounded routing budget, implement early provider-failure health events, and bind source/build hashes and capture time to the same in-memory assessment. The previous two-call routing allowance is exhausted. No customer routes should be rerun using this rehearsal.

Decision-time booking evidence is still needed for accuracy comparisons. Conditional recommendations remain verified=false; they do not establish actual cooking, driving, historical traffic or booking decisions. Continuous real-order delivery comparison remains disabled and undeployed.
