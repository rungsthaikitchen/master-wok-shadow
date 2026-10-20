# Authenticated delivery booking trial

Default-off private staging integration candidate, 20 October 2026.

Fixed stream 473cf9b1-393b-4644-873f-3071ffb610b1, order c4aa259f-f0ef-4703-bcec-3fc04c642020 (synthetic-delivery-trial), directory /data/delivery-http-473cf9b1. Reuses the existing private staging service, volume and credentials; no public domain, provider calls or cloud-backup requests.

The Node preparation module runs the actual RTK kitchen/delivery planner on explicitly synthetic five-minute outbound/eight-minute return route fixtures. It produces plans for creation and offers 1 and 3. Offer 2 intentionally has no estimate. Each complete snapshot/result is retained atomically in delivery-planning.sqlite3 with a SHA-256 digest and an opaque reference. The trial resolves each reference and matches the estimate before issuing writes. Evidence remains hypothetical; it is neither a Google routing validation nor actual kitchen/driver activity.

DeliveryBookingTransport is disabled by default and accepts only the existing fixed create/action query envelopes. A trusted in-process callback supplies planning evidence; no HTTP body field accepts a customer-provided plan. Creation and offers use parameterized delivery functions with role/DSN/TLS checks. Accept/reject/complete use the existing booking transaction. Admin confirm is explicitly unsupported by this adapter until its legacy target-field mapping is resolved.

The bounded run creates a planned delivery, makes two offers, refuses stale acceptance of offer 1, makes a new planned offer 3, accepts/retries it, completes/retries the order and refuses a conflicting rejection. Expected: ten writer attempts, one export, six events, three hypothetical comparisons and no remaining reservations. Persistent budget and a per-request deadline prevent unlimited repetition; restarting does not reset either budget or planning evidence. Node planning subprocess receives only PATH/LANG/TZ and its explicit enable flag, not database/operator/backup credentials.

Deployment sequence: deploy matching code with all trial flags false; install candidate SQL and narrow EXECUTE grants only in private staging with the stream disabled; verify; enable one bounded run; inspect source history and journal result; disable stream and all trial flags and restore idle runtime. Keep retained evidence. Existing collection and production services remain unchanged.
