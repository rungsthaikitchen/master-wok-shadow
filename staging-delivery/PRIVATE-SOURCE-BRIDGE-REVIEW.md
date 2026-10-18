# Minimal read-only source and private routing bridge

Prepared 18 October 2026 against staging commit 20a6bac7a542c9a812c61a0363361a616b48eec9. Uncommitted and undeployed. No production queries, paid routing calls, source writes or Railway mutations were made in this development step.

## Implemented

- delivery_minimal_candidate.py: default-off, parameterised fixed SELECT via the existing ManagementReadOnlySource, whose endpoint is /database/query/read-only. Requires an exact approved project URL, a pseudonym key, a verified owner-confirmed kitchen origin, supabase_read_only_user and transaction_read_only=on. Schema-qualified public tables; no DDL or privilege changes.
- One atomic bounded query selects up to 501 service-day orders and 5,001 items internally, computes a SHA-256 snapshot fingerprint, and returns only the earliest order and its basket/coordinates, plus coverage counts. More than 500 orders or 5,000 items is refused rather than treated as complete. A verified empty service returns no candidate.
- Only the unique earliest saved order is supported, and it must be a confirmed/completed delivery. The reader refuses earlier commitments, ties, collections, unacknowledged proposed times, missing items, malformed modifiers, coordinates or timestamps. Confirmed, proposed and preferred fields are preserved for the actual planner's precedence checks.
- delivery_private_bridge.py: binds the minimal private reader output to controller metadata using an actual Node preflight. Private input travels on stdin only; no file spool. Capture defaults off, requires a separate explicit opt-in, consumes its in-memory binding before invocation and cannot implicitly retry after timeout or failure. Child environment is allowlisted; provider key is passed only for an explicitly enabled capture.
- master-wok-private-route-bridge.js: independent default-off bridge to the existing real RTK planner and bounded Google adapter. Checks exact private input hash, current source freshness and source/build/date/status binding before route calls. Preflight uses zero-time simulated estimates to reject an infeasible kitchen case before quota. Capture requires explicit staging/live opt-ins, performs at most two directed requests with no retry, and emits only the aggregate envelope used by the journal. Route durations, points and detailed plans stay in process memory.

The source observation timestamp belongs to the exact private-input binding. It is excluded from the stable candidate state hash so a fresh poll of unchanged saved data does not spend another capture allowance. The build hash includes the JS model files and the Python source/bridge/controller/journal. Content, coordinate, policy/build or source snapshot changes can create a new candidate; the durable lifetime request cap still applies.

## Evidence and limitations

The Python-to-Node-to-controller integration test uses a real subprocess, the real planner and an injected simulated route transport. It records one aggregate, polls again and returns ALREADY_RECORDED without another simulated capture. Tests check that persisted payloads contain no basket, raw order ID, route points, durations or detailed plan. Source-role, coverage, origin, freshness, membership and default-off failures are tested. Node transport failures make one attempted simulated call and do not retry. Actual network requests to Google: zero.

The fixed query was also validated on staging project hvrqgufqjslvgiohgkvu inside BEGIN TRANSACTION READ ONLY / COMMIT, with a forced-empty WHERE false predicate. PostgreSQL accepted the SQL and column names, returning zero orders/items and read_only=on. The connector executed as postgres. This confirms SQL/schema compatibility only: that response is intentionally insufficient for the runtime's supabase_read_only_user guard. No source guard was relaxed. The runtime endpoint/token's actual role and transaction flag still require an acceptance check before activation.

The adapter remains intentionally narrow: it is a conditional retrospective first-order scenario, not a complete all-order live delivery planner. The unique-first-order proof permits an explicitly hypothetical empty prior plan. It does not establish that the saved target was in force when the order was placed, that no unrecorded work existed, or that the plan was followed. Current estimates are never presented as historical measurements. Later orders, multi-drop routes and current commitment-history coverage remain UNVERIFIED until a full input contract is available.

## Required integration and approval

1. Review and approve committing the six source/test files and this note. Existing live and staging deployments stay pinned until a separate deployment is approved.
2. Confirm the actual kitchen origin before enabling any real capture. The earlier origin came from supplied checkout configuration and was not independently verified; this new adapter deliberately refuses an unverified origin. Synthetic test points are not the restaurant location.
3. Bind the staging Management API read-only token to the exact approved staging project, verify the actual restricted role and read-only transaction, then exercise a synthetic candidate through preflight with capture disabled. Do not substitute the postgres connector role or request write permissions to make the check pass.
4. A runtime entrypoint must wire this library to a dedicated real-source journal identity/path, exact Railway scope, request budget, verified backups and external monitored health. The fixed synthetic daemon must not be repurposed by passing private input into its synthetic identity. No real-source entrypoint is deployed here.
5. Before paid capture, explicitly approve the customer/day scope, temporary coordinate handling and a fresh two-request allowance. The earlier call allowance is exhausted. Reserve quota durably through the controller before calling capture, and configure provider-side limits. Do not call the bridge directly from checkout or use its result to change availability.
6. Resolve the ongoing backup/retention policy and decision-time evidence before unattended real-order comparisons or accuracy claims. Broadening beyond the first saved delivery needs complete hypothetical kitchen/driver commitments or actual event evidence, not invented cooking activity.

## Documentation checked

Supabase changelog index and the 12 October TLS notice were checked. The notice excludes the Management API. Current read-only API documentation specifies /v1/projects/{ref}/database/query/read-only, database_read permission and supabase_read_only_user. PostgreSQL documentation confirms built-in SHA-256 and UTF-8 conversion functions. No new package dependencies, schema changes, RLS policies, security-definer functions or grants were introduced.

- https://supabase.com/docs/reference/api/v1-read-only-query
- https://supabase.com/changelog/cbc-tls-ciphers-deprecated
- https://www.postgresql.org/docs/current/functions-binarystring.html

Final Python and London/UTC Node test outputs are included. All route tests are simulated; the only database check was the forced-empty staging SELECT above.
