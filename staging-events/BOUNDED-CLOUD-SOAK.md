# Bounded read-only staging soak and independent cloud recovery

Default off. Uses the existing staging service, volume and bucket, with the already-disabled synthetic acceptance stream 25891531-e7da-462b-aee2-16a2dd9115db. It does not enable or modify that stream. No production access or database mutations are included.

The new dedicated directory /data/event-soak-2026-10-19-v1 holds a separate budget: at most six exports and one two-GET cloud recovery attempt. Attempts are consumed before I/O and persist across restarts. A fixed operator-set epoch deadline must be in the next ten minutes. Existing trial budgets, receipts and journals are not modified. A restart cannot extend the deadline or regain requests. The soak exits after six reads (60 seconds apart), failure, signal or deadline. Restart policy remains NEVER.

Cloud recovery reads the previous trial receipt and its exact remote manifest/snapshot keys, compares the downloaded manifest with the receipt, and passes only files to a fresh verification subprocess. That child receives PATH/LANG only, no database, management, operator or cloud credentials. It verifies hash, identity, content, counts and acknowledgement preservation and refuses an existing restore destination. This is independent process recovery on the same service host, not a separate-machine or replacement-volume disaster recovery exercise. No new objects are uploaded.

The private health API uses existing tokens; mutation requests terminate at an explicit refusal function. Each successful poll records authenticated 200 and unauthenticated 401 probes, comparison count and persistent read count. The latest three generated local snapshots are retained. All output remains verified:false because the source is synthetic.

Deployment evidence and exact final test results are appended only when observed. After the run, set MASTER_WOK_EVENT_SOAK_ENABLED=false and restore the normal disabled runtime command. Production remains unchanged.

## Observed deployment evidence — 20 October 2026

All 37 event-related Python tests passed locally in 12.103 seconds before deployment.

The initial approval action on 19 October was interrupted without reaching Railway; the four staged changes remained pending. On 20 October the deadline was refreshed and the deployment action returned committed:true. No previous request allowance was reset.

Deployment 5fe452f0-efe4-497a-b713-e806af6eff39, pinned b0baa836bd06b46c3d85284aeafd46a96a8a5f6f, reached SUCCESS. At 05:47:10 UTC it logged INDEPENDENT_CLOUD_RECOVERY_VERIFIED with sourceRequests=0. This downloaded the actual previous trial objects and restored them in a fresh subprocess with database/cloud credentials removed from its environment. It remains a same-host process-isolation drill.

The first poll at 05:47:13 UTC recorded one comparison; the second at 05:48:23 UTC reported ALREADY_QUEUED / IDLE with the same one comparison. Both reported zero mutations and authenticated/unauthenticated health 200/401. The remaining polls at 05:49:23, 05:50:33, 05:51:33 and 05:52:43 UTC each reported ALREADY_QUEUED / IDLE, observations=1, zero mutations and health 200/401. The final log SOAK_FINISHED reported exportAttempts=6 and mutationAttempts=0. The run spanned approximately five minutes thirty seconds between first and last poll. This is bounded synthetic stability evidence, not a long-duration production reliability claim.

Cleanup deployment 9ff51d24-0c1a-43f7-a3ee-569c59eb090f reached SUCCESS and logged DISABLED / sourceRequests=0 at 05:55:59 UTC. The soak flag is false and the normal default-off runtime command is restored. Railway reports no staged changes. The source/older budgets and production were unchanged.
