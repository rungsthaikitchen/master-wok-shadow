# Approved staging runtime rollout — 19 October 2026

The user explicitly approved the two staging-only database logins and storing generated credentials directly in Railway. This supersedes the credential block in RUNTIME-REVIEW.md.

The narrower grants in runtime-role-proposal.sql were applied to staging project hvrqgufqjslvgiohgkvu. Password activation used freshly generated SCRAM verifiers; neither plaintext passwords nor instantiated provisioning SQL is committed. The service-only reader/writer DSNs and distinct operator/health tokens were stored directly on the existing master-wok-continuous-comparison-staging service, without triggering deployment.

Verified: both logins have no superuser or RLS bypass; neither can read/update public.orders, edit/delete private events, or update streams.enabled. The writer has only the explicit per-table/per-column grants reviewed in runtime-role-proposal.sql. A new empty synthetic stream and controlled synthetic-runtime order were created, initially disabled. No existing RTK order rows or production service were modified.

The new bounded trial uses two service-local authenticated HTTP requests: one synthetic offer and its acceptance. It verifies initial health 503, unauthenticated health 401, then two background export/replay/local-snapshot cycles with healthy authenticated probes. Requests retain stable IDs and durable lifetime budgets. No public domain is added. IPv6 egress may be enabled for the staging direct database connection; workspace DNS cannot resolve the Supabase hosts, so direct authentication must be verified in the Railway runtime.

The source will be disabled again after the trial and the final runtime flag set false. Deployment IDs, logs and outcomes are recorded below when observed. A successful disabled build alone does not prove the connected database path or trial succeeds. This is a bounded synthetic rehearsal, not continuous production monitoring or off-volume recovery.
