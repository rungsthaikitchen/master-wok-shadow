# Production delivery evidence-only trial — review proposal

Prepared 17 October 2026. This package has not been pushed or deployed. It adds a production-capable runtime around the source and journal already accepted in staging. The new collector does not produce capacity recommendations or change bookings.

## Exact proposed scope

Repository: rungsthaikitchen/master-wok-shadow. Commit the nine reviewed files onto delivery-route-staging from expected parent 28c4f082769e31d76948615d2fe247e6c99fd35e. Keep main and all existing deployment pins unchanged. The package includes the new collector/tests, environment example, this rollout proposal, Python test evidence and four HTTP-response cleanup files for retained staging helpers/tests. No existing service is redeployed by the commit.

Create **one new service** named master-wok-delivery-evidence-production in Railway project 7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8, environment b61e66e7-dbaa-4343-9ca6-5e6f0f5d7612 (master-wok-production-shadow). Attach a **new dedicated 500 MB volume** at /data. Do not reuse a kitchen or staging volume. Pin the service to the new reviewed commit; branch pushes must not deploy it automatically.

Build with railway-shadow/Dockerfile, root /, and start `python railway-shadow/delivery_evidence_collector.py`. One replica; ON_FAILURE with three retries; overlap zero; draining 45 seconds; no cron or sleep. Use RAILWAY_RUN_UID=0 for the mounted volume as in the accepted staging integration. Journal and lock files are 0600; newly created parent directories are 0700.

Use production-shadow/delivery-evidence.env.example. Initial flag is **false**. Use private Railway references to the existing production observer's read-only Management token and stable pseudonym key; do not retrieve or copy their values into source, logs or chat. Generate a distinct random health token and keep it private. No Google key belongs on this service.

If explicitly approved, generate one public Railway HTTPS domain targeting port 8080 for authenticated monitoring. Its only useful route is /healthz, protected by the private bearer token. Public-domain creation is a separate exposure included in the proposed approval scope; a prior staging-domain request was blocked, and no public exposure was substituted then. An external monitor is not installed by this code package; connecting it requires access/configuration after a concrete URL exists.

## Runtime behaviour

The collector is disabled unless MASTER_WOK_DELIVERY_EVIDENCE_ENABLED is exactly true. Before credentials, files or source access, it checks exact Railway project ID, production-shadow environment ID/name, the NEW service name, and /data volume-mount metadata. Before journal creation or source access it also requires /data to be a real mount. Wrong scope or absent volume fails closed. Journal path is fixed to /data/master-wok-delivery-evidence/delivery-evidence.sqlite3; an existing incompatible journal or changed source identity is refused.

The source URL is fixed to https://ubyjrrsvbbqomitpaidb.supabase.co. Only the existing Management `/database/query/read-only` projection runs; each result must prove supabase_read_only_user. There is no source write function, caller-supplied SQL, customer address/coordinate-value lookup or Google provider. Data uses private delivery-specific HMAC aliases and the previously reviewed minimal projection. HTTP error responses are closed, and error bodies/exception strings are never logged.

Each cycle polls today and tomorrow in Europe/London, then waits 60 seconds. There is no date override or fault-injection mode. London midnight and daylight-saving changes advance the required health window automatically. Both days must have fresh successful source/journal polls; an old archived day's failure does not poison a new required window. One day's success cannot mask the other's failure.

The private health endpoint reports only HEALTHY/UNHEALTHY, scope SAVED_STATE_EVIDENCE_ONLY, prediction UNVERIFIED and verified:false. It returns 401 without the bearer token, 404 for other paths, Cache-Control:no-store, and 503 on incomplete, stale or failed coverage. Connections time out after two seconds so an idle health client cannot hold the only request worker indefinitely. Health combines in-process failure state with read-only journal freshness, including failed writes that could not be recorded on disk.

Logs contain service date, fixed failure codes, code hashes and numeric evidence counters, not aliases, baskets, tokens, source queries or customer information. `presentOrdersForDay` counts saved rows, not necessarily active deliveries or capacity reservations; an order rescheduled across days can still appear under its old preferred-date source window. Durable-state totals include retained history, not unique customers or orders.

SIGTERM/SIGINT mark health unhealthy immediately, stop before the next source read, and close the journal/server after the current operation. SQLite atomicity protects completed transactions if the container is forcibly stopped. Source HTTP socket timeout is 15 seconds and the Node audit timeout is 15 seconds; the source timeout is not a formal end-to-end wall-clock deadline. Draining time is set accordingly, and source-clock checks refuse stale results.

## What this trial establishes

It collects persistent saved booking evidence and explicit delivery readiness gaps. Every result stays UNVERIFIED, verified:false and recommendation:null. Healthy means the observer is collecting fresh evidence, not that deliveries fit. Saved completed status is not proof of physical cooking, a driver return or an original booking decision. Unknown journeys and incomplete kitchen/driver commitments remain explicit.

The journal retains only redacted readiness records plus input hashes. It does not retain full baskets or routes for later cooking replay. Future recommendation comparisons need their own reviewed input/provenance contract, directional route evidence and complete dated kitchen/driver commitments. Checkout and the current live capacity engine remain independent.

## Tests and evidence

113 tests pass in the full local Python working suite, including 15 new collector tests. Existing local suites include retained development/acceptance tests beyond this commit's files. The new tests cover default-off/no source calls, exact scope/path/volume guards, private configuration, London midnight/DST, identity consistency with the real normalizer, two-day polling with the real Node audit, partial failure/recovery, archived-day handling, restart deduplication, stopping between days, closed/redacted HTTP errors, authenticated private health, ignored staging/date controls and startup/port failures. The final suite also checks that older health helpers no longer leave expected HTTP error responses open.

The unchanged Node suite previously passed 124 entries in Europe/London and UTC. No new production source reads, Supabase writes, GitHub pushes, Railway mutations or Google requests occurred while preparing this package. Existing production service metadata and credential variable names were checked read-only; secret values were not retrieved.

The earlier actual staging source/journal integration passed restart, A->B->A rescheduling, controlled failure health 503 -> recovery 200, missing-presence history and same-volume backup/restore. The new production-only wrapper has been tested locally with injected synthetic readers and the real Node audit; it has not yet been run in Railway's Node 22/Python 3.12 container.

## Acceptance sequence after explicit approval

1. Verify branch lease and push the reviewed files. Create only the new service/volume in the exact production-shadow environment, pinned to the resulting commit. Configure default-off and private references. Inspect the entire environment patch and ensure it touches no existing resources/shared variables before applying it.
2. Deploy with enabled=false. Verify the exact commit and successful DISABLED/networkRequests:0 log. No source access or journal should occur at this stage.
3. If the approved scope includes the limited evidence-only trial, set enabled=true only on the new service. Verify both current London service days commit successfully, records remain UNVERIFIED, health returns 200 with authentication and 401 without, and repeated unchanged reads create no duplicate states.
4. Restart only this new service once to verify journal retention. Do not edit production orders or inject failures into production to repeat staging tests. Missing evidence is expected; it must never trigger a booking or route action.
5. If public health exposure is approved, generate the new HTTPS domain for port 8080 and verify authenticated access without exposing the token in a URL or logs. External alert delivery needs a separately configured monitor; do not claim alert coverage before it is tested.
6. Report the actual pinned SHA, deployment ID, journal identity/health and remaining dependencies. Any scope, identity, role, storage or semantic failure stops acceptance; do not broaden permissions, reuse a live write key or fall back to a write endpoint.

## Material operational dependencies

The current production read-only token was created for 30 days around 16 October, approximately expiring 15 November; verify/renew before expiry. Keep the private alias key stable across read-token rotation. The staging token still needs renewal around 22 October.

The SQLite backup/restore helper is tested, including actual same-volume staging checks. Scheduled **off-volume backups and recovery from volume loss remain outstanding**, as does independent external alerting for the new collector. A dedicated volume handles restarts; it is not a backup. Approval to enable now would therefore be a **limited evidence-only trial accepting possible loss of newly collected history until off-volume backups are established**, not full disaster-recovery readiness. No automatic data purge is included.

## Rollback

Set MASTER_WOK_DELIVERY_EVIDENCE_ENABLED=false or stop only the new service. Keep its volume for review/recovery. Remove its public domain only if a domain was explicitly approved and created. Leave the production kitchen observer, checkout backend, main branch, existing staging services and all production Supabase rows unchanged.
