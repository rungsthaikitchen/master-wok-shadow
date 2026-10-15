# Independent persistent shadow collector

This is an additional Python-compatible monitoring option. Start here for the simplest isolated next step; the earlier exact-event worker remains a separate integration interface.

**Status:** locally tested with mock REST responses and the real Node engine; disabled by default; not deployed or connected to live Supabase. Dockerfile is prepared but not built in this workspace (Docker is unavailable).

## What it does

The standalone process polls today and tomorrow in Europe/London every 60 seconds (configurable 30–3600 seconds). Each service day uses a bounded query matching preferred, proposed or confirmed time. Orders and items are read separately with stable pagination and exact counts. Two equal normalized projections are required before a sample is stored. An empty or incomplete candidate basket never becomes a GREEN result.

REST source code supports **GET only**, fixed orders/order_items projections, a fixed HTTPS Supabase origin and no redirects. There is no call to notification, loyalty, admin or checkout endpoints and no production database write method. Authentication is injected through environment variables. No source credentials were used during development.

The local SQLite database uses WAL and FULL synchronous commits on a dedicated persistent volume. It records poll health, presence, pseudonymized order states, item/modifier IDs and quantities, explicit original/proposed/confirmed timestamps, and a separate hypothetical replay hint. It stores no names, email, phone, addresses, notes, totals, modifier labels, raw source IDs, error bodies or credentials. HMAC aliases require a stable random secret. Unknown status strings become UNKNOWN. Item/modifier IDs are menu identifiers, so the source must use controlled IDs rather than free text.

Repeated identical polls create health/presence entries without duplicating unchanged order states. A later A→B→A change is retained. Reopening the DB preserves history; build/source/key changes require a new database path to avoid mixing identities. Source disappearance is presence information, not an invented cancellation. Summary output excludes absent orders from the latest successful sample and exposes per-day failures/staleness. Historical states remain stored for audit.

## What the model result means

`prediction` is always **UNVERIFIED** for polling records. `model_hint` is a separate GREEN/AMBER/UNVERIFIED diagnostic from a chronological replay of the current visible load approximation. The diagnostic envelope remains `verified:false` and labels chronology as polled final-state approximation.

The approximation includes current pending reservations where an effective time exists, active proposed times, confirmed/accepted and progressed orders. It excludes cancelled/customer-declined-time states and pending orders with unconfirmed proposals. This mirrors the relevant operational fallback in the supplied frontend; it does not establish historical acceptance. Final times may have changed after original order creation. Blackouts, missing/deleted orders, RLS visibility, unseen same-day reversals and historical menu changes are not proven by the sample. A proposal is not customer agreement, completed status is not measured cooking, and first-seen time is not decision time.

The summary compares **observed saved statuses versus hypothetical hints**, not proven decision-event parity. GREEN does not authorize a booking and AMBER does not decline one. The exact-event observer must not be fed these snapshots as `complete:true` pre-decision history.

## Runtime and approval dependencies

- Separate worker service/process with Python 3.12 and Node 22+. Existing Flask Python deployment alone does not establish Node availability. Do not import/run this inside server.py.
- Approved source credential with confirmed visibility of relevant non-test orders/items. Prefer an existing least-privilege read credential. This work does not create roles, tables, functions or credentials in production Supabase. GET-only application code is a safety boundary, not a substitute for database permissions.
- Dedicated persistent local POSIX volume, writable by UID 10001 if using the provided container. Never use an ephemeral container path or the application's source folder as the durable database. Single collector replica per DB/volume; volume ownership/backup must be checked in staging.
- Stable pseudonym secret of at least 32 random characters, provided through the hosting secret manager; never put values in the repository or logs. Retain it consistently for that DB. Database files and backups are still sensitive pseudonymous data and need restricted access.
- Proposed initial retention: 30 days for monitoring, with backups and source keys managed separately. This implementation deliberately includes no automatic deletion; agree retention and add a controlled maintenance job before a long-running production enablement. Monitor disk space.

`environment.example` contains names and placeholders only; its flag is false. Setting `MASTER_WOK_COLLECTOR_ENABLED=true` is an explicit opt-in, and has NOT been approved or performed here. When disabled the entrypoint does not inspect credentials, create a DB or call the network. A disabled container exits normally; do not deploy it as an always-restarting worker until service lifecycle is configured.

## Deployment plan for review

1. Build the separate container in staging; the Docker build context is the `master-wok` directory and Dockerfile is `railway-shadow/Dockerfile`. Do not replace server.py, notifications.py, index.html, admin.html or Edge functions.
2. Mount a dedicated persistent volume; inject approved staging read credentials, source URL and pseudonym secret. Run a one-shot staging sample. Verify projected columns, counts, known visible test-environment orders and no write/network methods beyond the GET source calls.
3. Restart the staging worker, repeat unchanged samples and status changes, and exercise read failure, changed pages, late/missing items, storage failure and unknown menu IDs. Compare a redacted busy-day export with the offline replay; do not claim a true historical reconstruction from final-state rows.
4. Review the concrete service configuration and staging results. Obtain explicit approval before production deployment, and approval for enabling production reads/monitoring. The current package does not create or configure any Railway service.
5. On approved enablement, run the independent worker, monitor per-day poll health, last-success age, model UNVERIFIED causes and disk usage. Starting alert candidates: no successful sample for 3 minutes, repeated source/replay errors, any storage failure, or rising missing-item failures. External monitoring is needed to detect a dead process; a dead process cannot write its own failure heartbeat.
6. Roll back by stopping/disabling this worker. Existing booking behavior is unaffected; retain its dedicated database for review.

## Reference commands

No user diagnostics are needed now. Commands are provided for a reviewer/test deployment:

```sh
python -m unittest discover -s railway-shadow -p 'test_*.py' -v
python railway-shadow/shadow_collector.py --once
python railway-shadow/shadow_collector.py --service-date 2026-09-18 --once
python railway-shadow/shadow_collector.py --summary
```

With the flag off these commands return DISABLED. A historical one-shot still reads current final rows, not an archived point-in-time snapshot. `--service-date` can repeat up to seven days. Without it, the loop recalculates today/tomorrow at each cycle, including daylight-saving transitions. One-shot failures exit nonzero; the loop records errors and continues. Summary requires the same configured identity and currently also validates the source URL/key configuration, but performs no REST requests.

The source is bounded to 5,000 rows per table/batch; the replay bridge is capped at 500 orders and 100 lines/order. The Node subprocess has a 15-second outer timeout and VM search limits. Exceeding bounds produces uncertainty rather than an incomplete GREEN sample. Polling reads may still load the database: tune frequency from measured staging latency, not assumptions.
