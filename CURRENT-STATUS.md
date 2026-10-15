# Master Wok — current review status, 15 October 2026

**Ready:** locally tested, disabled-by-default independent state collector and prior exact-event observer components.
**Not yet ready:** approved production deployment, proven live visibility/coverage, real historical trading-day validation, or exact booking-decision parity reporting.

## Delivered in this update

- Production-flow mapping from the supplied frontend, Railway Python and Supabase function sources.
- Independent Python GET-only state collector plus Node engine bridge. No changes to existing checkout, availability, admin, notifications or loyalty code.
- Separate SQLite persistence with restart durability, changed-state history, per-poll presence, pseudonymous aliases, source/build identity and health summaries.
- Hypothetical replay hints stored separately from evidence confidence. Polling predictions always remain UNVERIFIED; model hints never establish actual cooking activity or an exact decision history.
- A separate-worker Dockerfile and environment template, both prepared for review. Container build and live integration have not been run.

## Validation

- 22 Python tests passed (Python 3.12.14), including actual Node bridge execution on synthetic data, GET-only request construction, disabled entrypoint, stable pagination/count failures, DST day bounds, source changes, storage/model failures, privacy projection, restart recovery and a separate-process exit without database close.
- Existing six Node test files passed in Europe/London and UTC (Node 24.19.0; 25 runner entries in each run, including legacy multi-assertion test files).
- No live Supabase/Google/payment/notification calls were made. No backend or frontend production code was executed, modified, deployed or pushed. Input hashes document the reviewed source versions.

Test logs: TEST-RESULTS-COLLECTOR.txt, TEST-RESULTS-LONDON.txt, TEST-RESULTS-UTC.txt.

## Outstanding dependencies

1. Build and run the separate worker in staging with Python+Node, an approved read credential with known row visibility, a stable pseudonym secret and a dedicated persistent volume. The existing Flask service is not assumed to have Node. No further source uploads are needed to review this isolated collector.
2. Validate the actual database schema/projection and read permission coverage. No credential or live connection was supplied; source shapes are grounded in code, not tested against the database. No production schema/permission changes are included or authorized.
3. Provide a redacted real-day export to validate historical replay. Final-state rows can support approximate replay; exact chronological reconstruction requires ordered decision/revision/cancellation history, which the current sources do not establish.
4. Agree retention/access/backup and external process-health monitoring, then review concrete staging results before requesting production deployment/enablement approval.

## Concise deployment plan

Build the separate collector container in staging → mount a persistent volume and inject staging secrets → validate known order states, restart, outage and read-only behavior → review source coverage, retention and real-day replay → seek explicit approval before any production deployment or enablement.

Do not copy the whole ZIP into the production web root or replace server.py/index.html/admin.html. Start with railway-shadow/README.md and PRODUCTION-FLOW-REVIEW.md. The earlier REVIEW-AND-DEPLOYMENT.md is retained with an update banner and documents the distinct exact-event observer contract.
