# Bounded read-only staging soak and independent cloud recovery

Default off. Uses the existing staging service, volume and bucket, with the already-disabled synthetic acceptance stream 25891531-e7da-462b-aee2-16a2dd9115db. It does not enable or modify that stream. No production access or database mutations are included.

The new dedicated directory /data/event-soak-2026-10-19-v1 holds a separate budget: at most six exports and one two-GET cloud recovery attempt. Attempts are consumed before I/O and persist across restarts. A fixed operator-set epoch deadline must be in the next ten minutes. Existing trial budgets, receipts and journals are not modified. A restart cannot extend the deadline or regain requests. The soak exits after six reads (60 seconds apart), failure, signal or deadline. Restart policy remains NEVER.

Cloud recovery reads the previous trial receipt and its exact remote manifest/snapshot keys, compares the downloaded manifest with the receipt, and passes only files to a fresh verification subprocess. That child receives PATH/LANG only, no database, management, operator or cloud credentials. It verifies hash, identity, content, counts and acknowledgement preservation and refuses an existing restore destination. This is independent process recovery on the same service host, not a separate-machine or replacement-volume disaster recovery exercise. No new objects are uploaded.

The private health API uses existing tokens; mutation requests terminate at an explicit refusal function. Each successful poll records authenticated 200 and unauthenticated 401 probes, comparison count and persistent read count. The latest three generated local snapshots are retained. All output remains verified:false because the source is synthetic.

Deployment evidence and exact final test results are appended only when observed. After the run, set MASTER_WOK_EVENT_SOAK_ENABLED=false and restore the normal disabled runtime command. Production remains unchanged.
