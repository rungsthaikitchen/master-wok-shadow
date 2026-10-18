# Conditional delivery comparison persistence: review package

Prepared 18 October 2026 against commit 3abbeb1e4355c69d80d195733ea4eb16e27fbc4f. Uncommitted, undeployed changes; no paid requests or production access performed during this development step.

## Implemented

The existing SQLite comparison journal now has a dedicated RETROSPECTIVE_CONDITIONAL identity scope. It cannot open a database belonging to saved-state or synthetic comparisons. A strict aggregate contract stores source/build hashes, captured assessment time, saved status, evidence basis and conditional result. It rejects extra fields, including locations, baskets, order IDs, route durations and detailed plans. Conditional recommendations use their own prediction label and remain verified=false.

The default-off offline importer consumes at most 16 KiB of JSON on stdin. It checks the exact staging project and environment before reading input, then writes through the existing journal transaction/locking mechanism. It has no provider, HTTP, source-database or checkout integration. It prints a generic refusal on error, without echoing private input. Duplicate observations retain event history while deduplicating content; failed transactions roll back.

Only complete aggregate results from the one-customer, two-request retrospective contract are supported: SEPARATE_TRIPS_PREFERRED, NO_FEASIBLE_PLAN_IN_ARRIVAL_WINDOWS and KITCHEN_ASSESSMENT_UNVERIFIED. Early provider failures have a shorter contract and are deliberately refused by this importer. They still require a separate bounded health-event contract before continuous operation.

The input result's persistence=NONE describes the upstream runner's memory-only route handling. It is validated but not copied as a false claim that the aggregate journal is memory-only. The approved one-shot runner remains unchanged and does not invoke persistence.

## Caller contract

An enabled staging caller supplies result, sourceHash, buildHash, sourceIdentity, observedStatus and capturedAt. It must bind these values to the same in-memory source and assessment; the importer cannot independently prove provenance from hashes. capturedAt is the actual route-assessment capture time, never the historical service date. Import must occur within 180 seconds, allowing at most five seconds future clock skew. Do not reuse the earlier trial's old aggregate as a fresh result.

Required configuration: MASTER_WOK_RETROSPECTIVE_IMPORT_ENABLED=true, exact staging RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID, and an absolute MASTER_WOK_RETROSPECTIVE_DB path whose filename is delivery-comparison.sqlite3. Use a fresh dedicated private directory, not either existing comparison database. Keep the flag absent or false for the disabled baseline.

## Validation

Eight new tests cover default-off behavior, environment refusal, restart persistence, deduplication, privacy rejection, evidence/clock validation, scope separation and atomic write failure. Existing comparison tests cover lock and content-integrity behavior. Full Python and both timezone Node results are included in the package.

A truncated local shadow_collector.py dependency was restored verbatim from the pinned GitHub commit before testing. It is not an intended source change and is excluded from this patch package. Initial full Python run found missing boto3/botocore; pinned 1.43.114 dependencies were installed before the final run.

## Rollout and outstanding dependencies

1. Review and approve committing the four changed/new Python files to the staging branch. No production changes are included.
2. Prepare an isolated, disabled staging importer with a dedicated persistent directory. Do not reuse the active synthetic journal or attach a production write credential.
3. Run a synthetic aggregate persistence/restart/restore rehearsal. Existing cloud backup automation is scoped to the synthetic worker and must not be assumed to cover this new scope. Extend and test backup/restore and health monitoring before claiming reliable unattended persistence.
4. Review a separate bounded real-order activation: independently verify kitchen origin, bind minimal read-only snapshot coverage, set route freshness/request budgets and define provider failure events. Any new paid calls need explicit approval. The earlier two-call allowance is exhausted.
5. Connect assessment-to-import in memory only after approval of aggregate retention. Never pass raw routes, coordinates or detailed plans to the journal or logs. Persist aggregate evidence after successful validation; count persistence failures separately from assessment outcomes.
6. Add decision-time instrumentation before making booking-agreement or historical accuracy claims. Current saved status is not the original booking decision. Multi-drop testing still needs directed customer-to-customer legs and complete driver commitments.

This package is a tested persistence adapter, not an activated continuous real-order comparison service. Live routing remains disabled. Hypothetical plans remain hypothetical kitchen and driver activity.
