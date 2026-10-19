# Authenticated staging runtime — ready code, credential provisioning blocked

19 October 2026. No runtime has been deployed. Railway comparison staging remains on its previous disabled configuration (service 012e5ef6-6225-4ab3-95f5-894583db7e83, deployment 64885c45-a705-49d2-b650-aa73009c11a6, source 8922677). Existing staging volume/resources can be reused. Production is unchanged.

## What is implemented

- `event_runtime_http.py`: two operator-authenticated staging endpoints (`/staging/admin-action`, `/staging/customer-response`), separate authenticated `/healthz`, no-store responses, no payload/access logging, bounded request size/time. Customer-response is an operator test route, not a production customer identity system. The stream ID is bound by server configuration rather than accepted from request JSON.
- `event_runtime_transport.py`: separate reader/writer connections, exact staging host/user allowlists, required certificate-verified TLS, connection/statement/lock timeouts, fixed parameterized queries, role privilege checks and redacted failures. Reader transactions are read-only and refuse handler/INSERT privileges. No production URL, arbitrary query, service-role token or owner connection is accepted. Direct database host only; pooler URLs are not yet supported or tested.
- `event_runtime_staging.py`: default-off and exact Railway project/environment/service/synthetic scope checks. The background loop owns the replay journal; HTTP requests call only the database transaction. No Node assessment runs in the HTTP request path. Persistent budgets allow two export requests and three mutation attempts across restarts, including failures. Journal intake/replay must succeed and a local snapshot verify before health becomes good. Failed cycles and data older than 180 seconds fail health. This is a bounded rehearsal, not indefinite monitoring. The process shuts down after its two-cycle limit.
- New Dockerfile and pinned psycopg/psycopg-binary 3.3.6 requirements. Dependencies installed locally successfully. Docker build and direct DB/TLS authentication were not exercised.

## Evidence

New tests exercise the real local HTTP server against a synthetic source and actual durable journal/Node replay: unauthorized requests refused before a write, unhealthy initial health, authenticated offer + acceptance, persisted comparison, healthy response, repeat poll deduplication, stale health and failed-source health. Separate tests verify fixed query/role checks, unsafe DSN refusal, exception redaction, disabled configuration and durable budgets. Database driver operations use a fake DB-API connection in tests; the HTTP integration's source is local SQLite. Earlier live Postgres handler/reader evidence remains in HANDLER-RESULTS.md. Do not describe these new local tests as live authenticated service evidence.

## Credential block

The existing staging Railway service has a read-only management token but no database DSNs for these handlers. Its connected app exposes variable names, not secret values. No existing sealed or readable variable was overwritten.

An attempt to provision login-capable staging reader/writer roles was rejected by automatic approval review: persistent credentials and schema-wide writer read/write/delete scope were not explicitly approved. A subsequent read-only pg_roles check confirmed neither proposed login role exists. No workaround or alternate execution was attempted, and no credentials were saved to Railway.

`runtime-role-proposal.sql` is a narrower, unapplied review proposal. It names only the five private synthetic tables and necessary operations, rather than ALL TABLES or blanket DELETE. The reader can read stream/events and export; the writer can append events/commands, move/release reservations, update order status and advance counters. It cannot enable streams, create orders, modify/delete event history or command history, access public RTK tables, bypass RLS or act as superuser. Separate generated login credentials and their storage in service-only Railway variables still require approval. The SQL starts NOLOGIN; credential activation must happen only after that approval.

## Concrete rollout after approval

1. Apply the reviewed explicit grants in staging, activate fresh generated credentials, and save separate DSNs directly to the existing Railway comparison service; never put passwords in GitHub or chat. Test real TLS/role checks before enabling source writes. Verify staging DB network reachability; direct-host IPv6 may require enabling outbound IPv6 on this staging service.
2. Create a new empty synthetic stream and controlled synthetic order via the staging admin connection. Keep the stream disabled initially. Configure its UUID, distinct operator/health tokens, dedicated /data event directory, default-off runtime flag and exact synthetic scope on the existing staging service.
3. Pin the reviewed commit, switch to Dockerfile.event-runtime and the new command, deploy disabled first, verify terminal SUCCESS and disabled logs. Do not modify existing journal files or reset spent budgets.
4. Enable only the synthetic stream and bounded two-poll/three-mutation rehearsal. Test authenticated endpoints, replay persistence, stale/failure health and restart. Use private networking or bounded service-local probes; no public domain is required for the rehearsal. Disable afterward and verify no enabled source streams remain.
5. Add event-journal off-volume recovery and permanent freshness/failure alerting before calling it continuous monitoring. Current local snapshots do not establish cloud disaster recovery. No production rollout is included.

Validation: all 25 event-related Python tests passed in 21.826 seconds. The staging role-existence query returned zero proposed login roles after the rejected action. Neither Railway variables/config nor deployment state was mutated in this milestone.
