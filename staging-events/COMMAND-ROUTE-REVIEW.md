# Automatic command routing and observer handover — 25 October 2026

Update: the [hosted route-lock and restricted-runtime rehearsal](COMMAND-ROUTE-HOSTED-REHEARSAL.md) has now passed. It closes gates 1–3 below for the bounded synthetic scope; it does not close production coverage or continuous-operation requirements. The candidate and temporary runtime grants were installed privately in staging for that run, then the trial was disabled and its grants revoked. The original candidate-stage record follows.

Candidate for isolated synthetic staging review. Default disabled. No production booking, checkout, notification, database or deployment changes were made by this candidate.

## Behaviour

`command-route-candidate.sql` adds one authoritative private route per service day. Routed commands take a shared transaction advisory lock before reading its current stream. The administrator takes the exclusive form of the same lock, then seeds the destination baseline, authorizes old proposal responses and updates the route pointer in one transaction. A failed transaction leaves all four changes unapplied. Exact switch retries are idempotent; changed retries and a second cutover are refused. Existing stream locks remain in force after the route lock. Direct legacy writers do not acquire this new route lock and are not claimed to be covered.

The runtime has no route mutation or switch permission. Customer responses retain their authenticated origin and proposal revision; the database selects the current destination. Old response links can cross only the explicitly authorized immediate predecessor relationship. Admin confirmation uses a separate server-resolved-target contract; the legacy explicit-target confirmation helper is refused rather than silently reinterpreted.

`export_command_route` is STABLE and returns the pointer, attestation, current export and sealed retired export from one statement snapshot. This matters when a change commits after the observer's last poll but before cutover: a baseline contains the resulting state, but is not that missing decision's history. The observer therefore drains and acknowledges the complete retired prefix before acknowledging the destination and advancing its local route pointer. Baseline reservations never become historical decisions or actual cooking activity.

The bounded default-off observer retains separate journals, snapshots and restores both prefixes, verifies replay acknowledgement, and only then commits its route checkpoint. A crash before checkpointing can resume without duplicate observations. Restart, source failure, stale reads, changed bindings, prefix regression, corrupt retired/current journals or exhausted durable read budget prevent a healthy status. Health means the tested captured prefixes were processed; `verified` remains false and it does not authorize bookings.

## Validation

- Focused Python: 19 tests passed in Europe/London and 19 in UTC.
- PGlite SQL: 11 Node test entries passed in Europe/London and 11 in UTC.
- Adjacent response, HTTP, handover, booking and runtime regressions: 25 Python tests passed in each timezone. The first broader run lacked psycopg; installing the already-pinned runtime requirements locally resolved the environment failure without code changes.
- Hosted PostgreSQL 17.11: the SQL and proposed role grants were exercised inside a staging-only BEGIN/ROLLBACK transaction. Atomic failure rollback, exact retry, current route selection, old/new responses, stale proposal refusal, final reservation release and privilege catalogue checks passed.
- Hosted capture: initial source export had 2 events; a between-polls proposal made its sealed export 3 events; the destination finished with 4 events. The observer processed 2 real decisions in the retired journal and 1 in the destination, counting no baseline as a decision.
- Independent cleanup check: the temporary route table and routed function were absent, no temporary route grant remained, and enabled staging streams numbered zero.

`fixtures/command-route-hosted-captures.json` contains anonymized synthetic results from that rolled-back SQL execution. Python tests consume those captures locally; this is not a deployed network observer test. `command-route-hosted-rollback.sql` reproduces the hosted transaction against the existing private staging prerequisites. It contains temporary DDL and synthetic DML and must never be run in production. The runtime-role SQL is a proposal, not an installed grant.

## Remaining gates and deployment sequence

1. Exercise the new shared/exclusive route locks with simultaneous hosted sessions, including commit, rollback, lock timeout and exact retry. Earlier stream-lock concurrency evidence does not establish this new lock layer.
2. Exercise actual restricted reader/writer credentials through the fixed-query router and bounded observer, including authenticated HTTP response routing and interruption recovery. Catalogue permission checks and transport stubs alone do not prove this.
3. Use the existing staging test service and volume, with explicit finite budgets/deadline and synthetic identities. Deploy disabled, run the bounded trial, inspect independent source/journal evidence, disable again and revoke temporary grants. No new service or production configuration is needed for this gate.
4. Resolve production writer coverage and the legacy confirmation contract before proposing any live integration. See [coverage review](BOOKING-COVERAGE-AND-HANDOVER-REVIEW.md). The empty-looking active `order-confirm` function, direct admin writes, alternative checkout paths and other uncaptured writers remain unresolved.

Scope is deliberately one cutover on one service day. Multi-hop and connected-day routing are refused. A generation-zero route with no events has no decision export and cannot report observed health until an event exists or an explicit empty cutover baseline is created. The read budget is for a rehearsal, not an unattended production scheduling policy. Continuous scheduling and public monitoring integration are not supplied here.

Rollback for an isolated rehearsal is to stop/disable its runner, preserve its journals, revoke temporary runtime grants and retire synthetic streams. Do not reverse the route pointer or erase event history to simulate rollback. Production polling and live scheduling remain separate from this candidate.
