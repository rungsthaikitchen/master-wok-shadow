# Bounded authenticated transfer trial

21 October 2026. Private staging only: hvrqgufqjslvgiohgkvu; existing Railway comparison service 012e5ef6-6225-4ab3-95f5-894583db7e83. No production tables, checkout changes, public endpoints, new services or volumes.

The runner is default-off. An explicit staging project/environment/service identity, all other runtime/trial flags false, and a deadline within ten minutes are required. Dedicated persistent request counters allow one start, at most ten writer calls and three reader calls; a restart cannot repeat the mutation sequence. The staging DSNs, restricted roles and certificate verification are reused without exposing credentials.

Two synthetic collection bookings start on 21 and 22 October. Two authenticated writer connections request opposite-direction moves of different orders. The first transaction pauses after both event writes, before commit. While both writer calls are in flight, the fixed read-only reader must return the original two bookings and no transfer receipts. After both commit, a second consistent export must contain both transfer pairs. This exercises concurrent connections; it is not a throughput benchmark or proof of an exact lock-wait duration.

The second export is persisted. A child worker terminates with os._exit(73) after writing the combined acknowledgement inside SQLite but before COMMIT. It receives no database credentials. Reopening must reveal zero acknowledged bundles, then an identical retry must acknowledge the whole pair exactly once. A separately opened local snapshot must verify the evidence and remain idle, without replaying acknowledged work.

The writer also checks a stale response against the moved source, an identical move retry, acceptance on the destination, a return move and completion. The final export must contain ten events and three transfers; the final hypothetical replay contains three comparisons. The actual request budget for this fixed sequence is nine writer and three reader calls. No new travel estimate is invented or inherited.

Receipt INSERT is granted only to the existing writer and requires both enabled synthetic streams. Reader SELECT includes receipts between synthetic streams even if a counterpart is disabled: otherwise row filtering could hide third-stream history from the export closure check. The reader has no move EXECUTE or event INSERT privileges. This is private fixture access, not a production grant design.

Local validation: default-off/scope refusal; persistent start and concurrent budget enforcement; a real process exit before commit followed by snapshot recovery; and coordinated two-writer invocation. All 68 Python event tests pass. The old delivery fixture now freezes its recorded assessment/event time so the test remains reproducible after 20 October. Existing paired-gate tests remain applicable. Authenticated Railway execution and observed results are recorded below after the run, not inferred from local mocks.

Cleanup: set the transfer flag false and deadline zero; restore the disabled runtime start command; disable both fixture streams; release any remaining synthetic reservation in the isolated fixture only after preserving the final export. Do not delete durable evidence. No independent cloud backup of the new bundle path is claimed.

## Observed authenticated result

Pinned code: 81a63346896fc686bac30833afcd1af599f8160e. Disabled preflight deployment bf697ad2-22e0-4774-9b80-d4ddd42448f7 reached SUCCESS and logged DISABLED/sourceRequests=0. Authenticated trial deployment bfe0d799-04fe-4d57-be0f-083859d20791 reached SUCCESS and logged at 2026-10-21T06:06:39.443180728Z:

```json
{"status":"OBSERVED","scope":"SYNTHETIC_TRANSFER_TRIAL","verified":false,"attempts":{"started":1,"writer":9,"reader":3},"transferCount":3,"eventCount":10,"comparisons":3,"interruptedExit":73,"restored":true,"initialComparisons":2,"networkRequestsByReplay":0}
```

This log is emitted only after the uncommitted-snapshot, opposed-move, stale-source-response, identical-retry, destination-acceptance, return-move, completion, process-termination and reopened-snapshot checks pass. Artifacts remain under /data/transfer-trial-c853a827: counters, source exports, bundle journal, restored snapshot and trial-result.json. No cloud recovery of this path has been claimed.

An independent management read captured the final ten-event, three-transfer export before fixture cleanup. It is retained as fixtures/cross-date-authenticated-capture.json. The regression gate reproduces one remaining provisional commitment on 21 October and none on 22 October. Acceptance did not add a duplicate commitment, and completing the returned order released its reservation.

The three recommendation observations are UNVERIFIED/REPLAY_UNVERIFIED, not GREEN: this lifecycle fixture contains only jasmine rice, with zero Rung workload. The current raw-duration replay path requires a positive duration. A separate offline sensitivity check, replacing each basket consistently with one chicken panang curry, gives GREEN for all three comparisons. That modified history is an explicitly synthetic check and is not represented as the authenticated capture. Supporting zero-Rung-work baskets needs an offline regression/fix before claiming useful coverage of that case.

68 Python event tests pass. All 19 focused staging Node tests pass in London and UTC. Core Node code was unchanged in this step; the preceding 183-per-timezone core result is not reported as a fresh run. An additional management SET ROLE probe was refused by the database; no membership was added to bypass that refusal. The trial itself used the actual restricted reader/writer login connections and checked their roles.

## Verified cleanup

The final export was preserved first. A separately labelled administrative fixture cleanup cancelled the other synthetic order through apply_booking(), recording an eleventh event rather than silently deleting a reservation. Both fixture streams are now disabled, no trial reservations remain, and enabled stream count across the private schema is zero. The three transfer receipts and all events are retained.

Temporary transfer receipt SELECT/INSERT privileges and move/export EXECUTE grants to the runtime roles were revoked. Definitions and their RLS policies remain installed in the private staging schema; another trial would require deliberate regranting. The matching transfer-aware record() and moved-row guards remain installed, with no production schema changes.

MASTER_WOK_TRANSFER_TRIAL_ENABLED was set false, its deadline zero, and the start command restored to python railway-shadow/event_runtime_staging.py. Cleanup deployment 1bbb4a12-25ae-4a69-be6f-63275492632f reached SUCCESS and logged DISABLED/sourceRequests=0 at 2026-10-21T06:20:47.588144116Z. The service remains pinned to the tested code; no domains, services or volumes were added.

Next work: resolve the zero-workload replay edge case; route transfer histories into the paired controller with separate acquisition-freshness health; include new evidence in independently tested recovery; then close active-writer coverage and baseline gaps before production event capture. Histories connected to more than two streams remain explicitly unsupported.
