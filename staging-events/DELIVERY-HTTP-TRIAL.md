# Authenticated delivery booking trial

Default-off private staging integration candidate, 20 October 2026.

Fixed stream 473cf9b1-393b-4644-873f-3071ffb610b1, order c4aa259f-f0ef-4703-bcec-3fc04c642020 (synthetic-delivery-trial), directory /data/delivery-http-473cf9b1. Reuses the existing private staging service, volume and credentials; no public domain, provider calls or cloud-backup requests.

The Node preparation module runs the actual RTK kitchen/delivery planner on explicitly synthetic five-minute outbound/eight-minute return route fixtures. It produces plans for creation and offers 1 and 3. Offer 2 intentionally has no estimate. Each complete snapshot/result is retained atomically in delivery-planning.sqlite3 with a SHA-256 digest and an opaque reference. The trial resolves each reference and matches the estimate before issuing writes. Evidence remains hypothetical; it is neither a Google routing validation nor actual kitchen/driver activity.

DeliveryBookingTransport is disabled by default and accepts only the existing fixed create/action query envelopes. A trusted in-process callback supplies planning evidence; no HTTP body field accepts a customer-provided plan. Creation and offers use parameterized delivery functions with role/DSN/TLS checks. Accept/reject/complete use the existing booking transaction. Admin confirm is explicitly unsupported by this adapter until its legacy target-field mapping is resolved.

The bounded run creates a planned delivery, makes two offers, refuses stale acceptance of offer 1, makes a new planned offer 3, accepts/retries it, completes/retries the order and refuses a conflicting rejection. Expected: ten writer attempts, one export, six events, three hypothetical comparisons and no remaining reservations. Persistent budget and a per-request deadline prevent unlimited repetition; restarting does not reset either budget or planning evidence. Node planning subprocess receives only PATH/LANG/TZ and its explicit enable flag, not database/operator/backup credentials.

Deployment sequence: deploy matching code with all trial flags false; install candidate SQL and narrow EXECUTE grants only in private staging with the stream disabled; verify; enable one bounded run; inspect source history and journal result; disable stream and all trial flags and restore idle runtime. Keep retained evidence. Existing collection and production services remain unchanged.


## Authenticated result — passed

Code 6a60b2e93cb04eb56a8e44eac71440c0093505a7, existing private staging service 012e5ef6-6225-4ab3-95f5-894583db7e83 in environment c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279.

- Disabled deployment b9943d40-c079-43c6-ba85-6f407c1553f8 succeeded, logging DISABLED/sourceRequests=0 at 09:49:10 UTC.
- Delivery candidate constraint/functions and three private EXECUTE grants installed atomically in staging. Existing writer column grants and enabled-synthetic-stream RLS were unchanged. Preflight verified writer_create=true, anon_create=false, authenticated_apply=false and writer_enable_stream=false. No credentials or role memberships changed.
- Trial deployment 96b8ac32-3ca4-4b63-ae99-790e3a774d38 succeeded. At 09:52:24 UTC it logged OBSERVED/QUEUED/RECORDED, observations=3, attempts={reader:1,writer:10}, httpCalls=10, retainedPlanningRecords=3, verified=false.
- Source audit found six events and six command receipts. Creation and offers 1/3 each retain the exact prepared estimate in their source event; all three command-to-event estimate equality checks passed. Offer 2 has null evidence and does not inherit the earlier estimate.
- Stale response and conflicting post-completion rejection were refused. Identical acceptance and completion retries added no events. Final row is completed with original preferred 17:00Z, proposed/confirmed 19:00Z, null current proposal, zero reservations. Those saved times are booking metadata, not actual activity.
- Real planner estimates gave seventeen minutes from food-ready through estimated arrival for these fixtures: within the twenty-minute maximum but above the preferred under-fifteen-minute band. This includes hypothetical holding/loading/transit; it is not an observed delivery duration.
- Actual authenticated export retained in fixtures/delivery-booking-authenticated-capture.json. Independent replay gives three comparisons (London: GREEN/UNVERIFIED/GREEN), zero commitments, verified=false. Re-running the real planner at the captured assessment instant reproduces each captured estimate exactly. All seventeen focused staging tests pass in both London and UTC. Core suite: 175 passed per timezone; Python event suite: 59 passed.
- Stream disabled after the trial: source audit found zero enabled streams, six retained events and zero reservations. Evidence and exhausted budget retained on the existing volume. Planning evidence is not yet covered by the independent cloud-recovery pipeline; extend that coverage before relying on it for production capture.
- No new infrastructure, provider requests, public domains or production database/service changes. Security advisor has no new findings; the same two informational no-policy notices remain on private delivery-test tables, https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy . No grants were widened to silence them.

The delivery functions and restricted grants remain installed only in staging. This trial validates the actual planner -> authenticated backend -> transaction -> persistent replay path with synthetic route inputs; live route-evidence ingestion, initial baseline and full live-writer coverage are separate requirements. Cross-date lifecycle transfer is the next development work package.

Cleanup deployment ec7cf392-971f-40b9-8b2f-92b9b3832f17 succeeded at 09:55:57 UTC with DISABLED/sourceRequests=0. The normal event_runtime_staging.py start command was restored; delivery trial flag is false, deadline zero, and no Railway changes remain staged. Source is pinned to the tested code revision; this results-only commit does not redeploy it.
