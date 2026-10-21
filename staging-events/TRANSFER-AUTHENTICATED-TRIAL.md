# Bounded authenticated transfer trial

21 October 2026. Private staging only: hvrqgufqjslvgiohgkvu; existing Railway comparison service 012e5ef6-6225-4ab3-95f5-894583db7e83. No production tables, checkout changes, public endpoints, new services or volumes.

The runner is default-off. An explicit staging project/environment/service identity, all other runtime/trial flags false, and a deadline within ten minutes are required. Dedicated persistent request counters allow one start, at most ten writer calls and three reader calls; a restart cannot repeat the mutation sequence. The staging DSNs, restricted roles and certificate verification are reused without exposing credentials.

Two synthetic collection bookings start on 21 and 22 October. Two authenticated writer connections request opposite-direction moves of different orders. The first transaction pauses after both event writes, before commit. While both writer calls are in flight, the fixed read-only reader must return the original two bookings and no transfer receipts. After both commit, a second consistent export must contain both transfer pairs. This exercises concurrent connections; it is not a throughput benchmark or proof of an exact lock-wait duration.

The second export is persisted. A child worker terminates with os._exit(73) after writing the combined acknowledgement inside SQLite but before COMMIT. It receives no database credentials. Reopening must reveal zero acknowledged bundles, then an identical retry must acknowledge the whole pair exactly once. A separately opened local snapshot must verify the evidence and remain idle, without replaying acknowledged work.

The writer also checks a stale response against the moved source, an identical move retry, acceptance on the destination, a return move and completion. The final export must contain ten events and three transfers; the final hypothetical replay contains three comparisons. The actual request budget for this fixed sequence is nine writer and three reader calls. No new travel estimate is invented or inherited.

Receipt INSERT is granted only to the existing writer and requires both enabled synthetic streams. Reader SELECT includes receipts between synthetic streams even if a counterpart is disabled: otherwise row filtering could hide third-stream history from the export closure check. The reader has no move EXECUTE or event INSERT privileges. This is private fixture access, not a production grant design.

Local validation: default-off/scope refusal; persistent start and concurrent budget enforcement; a real process exit before commit followed by snapshot recovery; and coordinated two-writer invocation. Existing paired-gate tests remain applicable. Authenticated Railway execution and observed results are recorded below after the run, not inferred from local mocks.

Cleanup: set the transfer flag false and deadline zero; restore the disabled runtime start command; disable both fixture streams; release any remaining synthetic reservation in the isolated fixture only after preserving the final export. Do not delete durable evidence. No independent cloud backup of the new bundle path is claimed.
