# Approved staging runtime rollout — 19 October 2026

The user explicitly approved the two staging-only database logins and storing generated credentials directly in Railway. This supersedes the credential block in RUNTIME-REVIEW.md.

The narrower grants in runtime-role-proposal.sql were applied to staging project hvrqgufqjslvgiohgkvu. Password activation used freshly generated SCRAM verifiers; neither plaintext passwords nor instantiated provisioning SQL is committed. The service-only reader/writer DSNs and distinct operator/health tokens were stored directly on the existing master-wok-continuous-comparison-staging service, without triggering deployment.

Verified: both logins have no superuser or RLS bypass; neither can read/update public.orders, edit/delete private events, or update streams.enabled. The writer has only the explicit per-table/per-column grants reviewed in runtime-role-proposal.sql. A new empty synthetic stream and controlled synthetic-runtime order were created, initially disabled. No existing RTK order rows or production service were modified.

The new bounded trial uses two service-local authenticated HTTP requests: one synthetic offer and its acceptance. It verifies initial health 503, unauthenticated health 401, then two background export/replay/local-snapshot cycles with healthy authenticated probes. Requests retain stable IDs and durable lifetime budgets. No public domain is added. IPv6 egress may be enabled for the staging direct database connection; workspace DNS cannot resolve the Supabase hosts, so direct authentication must be verified in the Railway runtime.

The source will be disabled again after the trial and the final runtime flag set false. Deployment IDs, logs and outcomes are recorded below when observed. A successful disabled build alone does not prove the connected database path or trial succeeds. This is a bounded synthetic rehearsal, not continuous production monitoring or off-volume recovery.

## Observed deployment evidence

- Disabled baseline: a66c79ee-b40a-4237-9ece-9ec0cdb0c6a8, commit 512c59d, terminal SUCCESS; DISABLED / zero source requests at 08:10:35 UTC.
- First enabled attempt: 10318f6a-87b8-4eef-ac8b-f43b23df5365, stopped UNVERIFIED before any source events. Diagnostic revision 1c01d7 (deployment fce29b36-7f31-4b5f-9d34-f6074894c82b) identified DATABASE_TLS_CERTIFICATE_UNVERIFIED. Both connection attempts consumed the existing durable writer budget. No source events/commands were recorded by either failed attempt.
- Fix: bundle Supabase Root 2021 CA, fetched over HTTPS from https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt ; DER SHA256 807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa. Certificate subject/issuer Supabase Root 2021 CA; valid through 26 April 2031. The adapter pins this fingerprint and retains verify-full hostname checking. No TLS verification bypass was introduced. Supabase's SSL guidance explains the required provider CA: https://supabase.com/docs/guides/platform/ssl-enforcement . The system CA bundle alone was insufficient.
- Connected trial: 9b3f5f2d-1e7b-402f-a15b-7b9b3081f3a7, commit bc7de2e, terminal SUCCESS. Its startup budget log showed 0 export attempts and 2 mutation attempts already consumed. The fixed offer-only trial used the remaining mutation attempt; the acceptance HTTP call was deliberately omitted. This trial does not establish deployed acceptance-path evidence; that path retains prior SQL/local HTTP evidence.
- At 08:29:49 UTC, OBSERVED / QUEUED / RECORDED with 1 persisted observation, authenticated health 200, unauthenticated health 401, exportAttempts=1, mutationAttempts=3. This proves standalone writer/reader database authentication, strict TLS trust and the operator HTTP → transaction → read-only export → durable replay path for this synthetic offer.
- A read-back confirmed exactly one event, proposed order status and one reservation. The source was then disabled while the final read-only poll completed. No event/history budget was reset and no synthetic result was promoted to verified kitchen activity.

Local validation after CA/diagnostic fixes: all 28 event-related Python tests passed in 33.507 seconds. No Node engine code changed. The deployed runtime uses the existing staging volume and no public endpoint/domain; no production changes were made.

- Second connected poll at 08:30:59 UTC: OBSERVED / ALREADY_QUEUED / IDLE, still exactly 1 observation; health 200 with authentication and 401 without; exportAttempts=2 and mutationAttempts=3. Both export attempts and all mutation attempts are now spent, including the failed TLS connections. No counters were reset or limits expanded.
- Read-back after cleanup showed zero enabled synthetic streams, and the completed trial retained exactly one source event in its disabled stream. Runtime flags were committed false; the disabled deployment verification follows below.

Outstanding: deployed customer-acceptance HTTP evidence (omitted to honor the remaining mutation budget), event-journal off-volume backup/restore and a sustained monitoring/retention policy. The successful trial is not indefinite live shadow operation and contains no actual customer booking decisions.

Final disabled deployment: cd0dcc67-16a6-44ad-898c-296b4e96497d, pinned bc7de2e, terminal SUCCESS. At 08:35:11 UTC its log reported DISABLED, verified:false, sourceRequests:0. No staged Railway changes remained after committing the cleanup. Reader/writer credentials remain installed with the approved narrow privileges, ready for future reviewed staging work; the runtime and source are off.
