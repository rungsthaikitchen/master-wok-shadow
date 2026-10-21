# Paired monitoring and recovery integration

21 October 2026. Default-off staging implementation only. No deployment, production/source database changes, object-store requests, new services, domains or volumes in this step.

## Resulting behaviour

PairMonitor acquires a fresh, consistent export through the existing fixed read-only TransferPairReader, validates and persists the pair, drains complete paired work, then requires a matching recovery proof before reporting healthy. An unchanged source read refreshes acquisition health while reusing the saved comparison and exact content recovery proof. It does not create duplicate acknowledgements or upload unchanged evidence repeatedly.

Health is distinct from acknowledgement. STARTING, ACQUIRING, a source/validation/worker/recovery failure, exhausted request allowance, changed/corrupt evidence, or an acquisition older than 180 seconds is unhealthy. A restart clears usable freshness even if historical ACKs and recovery proofs exist. Acquisition start time defines freshness, so slow comparisons/backups cannot pretend the source was read at completion time. Health queries use a separate read-only SQLite snapshot and never invoke source, planner or cloud clients.

The explicit route_export integration point catches TRANSFER_BUNDLE_REQUIRED from the ordinary single-stream journal and invokes a new paired acquisition only when the configured pair covers that stream. It never assembles a pair from independently polled single sides. Without a matching enabled pair monitor it returns UNVERIFIED. Existing deployed single-stream runtime wiring is unchanged; the new staging entry point uses the paired reader directly.

The paired store now also verifies stored history/watermarks against the latest immutable bundle content, plus SQLite format identifiers. This prevents a valid-looking ACK from concealing modified stream tracking data. Old immutable ACK results are not reassessed during verification. A changed replay build still prevents old pending work being acknowledged under another build.

## Recovery

PairRecovery is default-off. When explicitly enabled with the existing object-store configuration, it creates a complete SQLite snapshot containing both source histories, transfer receipts inside the bundle payload, results, acknowledgements and controller counters/state. The manifest binds identity, both stream IDs, full evidence fingerprint, file hash/size, counts and the restore policy.

It uploads the snapshot and manifest, reads both back, checks their content, restores to a new scratch database and reopens the ACKs. It never replaces an existing destination. A recovery_guard permanently blocks source reads from copies restored through this path; no request allowance is replenished by restoration. The independent event_transfer_recovery_check.py entry point performs the same offline verification in a new process without source/cloud credentials or requests.

Recovery proof caching binds the precise core evidence and destination. Health timestamps and proof rows are excluded from that fingerprint so unchanged polls do not require uploads. Changed histories/results require a new proof. Corrupt receipts, bad downloads, missing/partial ACKs and exhausted recovery allowance remain unhealthy. A cached successful round trip is historical content evidence, not a continuous guarantee that an external object remains available forever.

The implementation was exercised with an injected in-memory object service and an independent child-process restore. No real object-store recovery run or off-volume provider availability claim is made in this step. Separate delivery route-planning evidence lives outside this bundle database and is NOT included by this backup; its recovery integration remains a separate requirement.

## Bounded staging entry point

`python railway-shadow/event_transfer_monitor_staging.py`

It requires explicit project/environment/service identity, synthetic scope, both configured stream UUIDs, all other runtime/trial flags false, a private health token, read-only staging DSN, existing bucket configuration, and an expiry at most ten minutes ahead. The new enabling flags are MASTER_WOK_TRANSFER_MONITOR_ENABLED and MASTER_WOK_TRANSFER_MONITOR_RECOVERY_ENABLED; neither is active by default. MASTER_WOK_TRANSFER_MONITOR_STREAMS is a two-element JSON UUID array and MASTER_WOK_TRANSFER_MONITOR_END_EPOCH is the trial deadline.

Persistent limits allow eight source reads, at least sixty seconds apart, and at most two recovery attempts. Each recovery attempt uses two logical writes and two reads; SDK transport retries remain bounded by the existing storage client. Restarts preserve spent allowances. There is a sixteen-bundle / twenty-megabyte recovery cap. These are deliberate trial bounds, not an unattended production retention or backup policy. Stopping the bounded monitor marks health unhealthy.

The GET-only authenticated /healthz endpoint reports acquisition/recovery health, not verified capacity. Booking POSTs are refused; no writer client is created. Existing Railway service/source pins, flags and revoked transfer grants remain untouched by this implementation commit.

## Deployment plan and dependencies

1. Keep production unchanged. For the next bounded staging rehearsal, use the existing private comparison service and volume, pin the reviewed commit, and first verify the new entry point logs disabled with zero requests.
2. Deliberately authorize reader SELECT on the private receipt table and EXECUTE on export_transfer_pair, using the existing reviewed RLS. Enable only the selected synthetic fixtures; no move-function or event-write grant is needed for this read-only monitor.
3. Enable the monitor/recovery flags with a ten-minute deadline. Verify authenticated paired acquisition, the existing bucket round trip, duplicate polling and health failure/recovery. No new infrastructure is required, but no provider trial has been performed by these local tests.
4. Disable flags, zero the deadline, restore the disabled start command, disable fixtures and revoke temporary reader grants. Preserve the evidence and proof records.
5. Before production event capture, complete wider connected-history handling, full active-writer/baseline coverage, recovery of separately retained planning evidence, and a reviewed production monitoring/retention/request policy. Unsupported histories, empty pair members and unverified delivery estimates must keep failing closed.

A healthy monitor means fresh, complete paired evidence was processed and a matching recovery round trip was demonstrated. Recommendations may still be UNVERIFIED; none of these states confirms actual cooking, travel or a booking decision.

Validation: all 79 Python event tests pass. The 20 focused transfer tests pass, including 11 new monitor/recovery tests; the new monitor suite also passes with TZ=UTC. Tests use synthetic captures and injected object storage. Node implementation files are unchanged in this step; the preceding 187 core / 19 staging tests per timezone are not presented as new runs.
