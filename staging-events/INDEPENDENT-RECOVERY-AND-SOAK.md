# Independent process recovery and repeated-poll preparation

This increment adds an offline recovery CLI, `railway-shadow/event_recovery_check.py`. It accepts an existing snapshot, its manifest and a new absolute destination named `event-capture.sqlite3`. It checks size, format, restore policy, SHA-256, source identity, logical fingerprint, counts and preserved ACK state. An existing destination is refused. It has no source transport or cloud operations and does not start a runtime or create request budgets. A manifest is a consistency record, not an independent signature or proof of provenance.

A subprocess regression test restores exported test objects in a fresh Python process and checks that a second invocation cannot overwrite the restored database. This uses synthetic local storage; it does not claim a second Railway environment or an independent real-bucket disaster-recovery drill.

The repeated-poll test runs 100 unchanged synthetic exports through intake, replay, monitoring and recovery. It checks a stable comparison count and a single four-operation storage round trip; subsequent recovery checks use cached proof. This is an accelerated correctness test, not elapsed-time availability evidence.

Polling previously accumulated one local snapshot per cycle. The runtime now keeps the latest three generated snapshots in its dedicated directory, pruning only regular, non-symlink files matching the exact generated UUID filename pattern after a successful new snapshot. Manually named files and the active journal/budget/receipt are excluded. Cloud objects are not deleted.

The deployed runtime remains the prior disabled version with its original two-read/three-write cap. No spent budget was reset, no service or bucket was created and no production changes were made. Before a sustained cloud run, introduce a separately identified, explicitly bounded read-only soak profile with a fixed end time and persistent total read allowance. Preserve the previous trial budgets. Independent real-bucket recovery should use the saved manifest/key in a separate process without source/writer credentials; the offline CLI must not be used as a production startup procedure.

Validation: all 34 event-related Python tests passed in 12.387 seconds after installing the existing pinned runtime dependency. No Node engine code changed.
