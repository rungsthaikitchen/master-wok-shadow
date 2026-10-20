# Consistent transfer export and atomic comparison gate

20 October 2026. Review candidate only. No deployment, permanent database change, runtime grants, production writes or new infrastructure.

## Resulting behaviour

export_transfer_pair() returns both non-empty enabled synthetic streams and their transfer receipts in one STABLE, SECURITY INVOKER function call. PostgreSQL's statement snapshot applies to its SELECTs and the existing STABLE export() calls. It refuses a third stream connected by any transfer receipt, and caps the returned JSON at ten megabytes. Reader access to booking_rows is not required: anonymous order aliases come from the outgoing source events.

The offline gate checks both complete event histories, exact receipt/counterpart coverage, dates, order identity, unchanged held baskets, event timestamps and target instants (including microseconds). Missing/duplicate receipts, missing counterpart events, outside streams, partial histories or inconsistent clocks give UNVERIFIED with no partial results. The CONSISTENT_TRANSFER_SNAPSHOT label alone is not independent proof of acquisition: the fixed reader and trusted SQL function establish that boundary.

The new reader is default-off, pins the staging DSN/TLS/role and executes only the fixed parameterized export query inside a read-only transaction. It refuses writer privileges. Its real authenticated use is a subsequent trial; current transport tests use a fake connection to inspect the fixed query and guards.

The new transfer-bundles.sqlite3 store treats the complete snapshot as one work item. Validation precedes intake. Both stream histories/watermarks and the pending bundle are inserted atomically. Both replay results are validated and stored with ONE acknowledgement transaction. A crash/failure after the first or second comparison cannot acknowledge one day independently. The ordinary EventCaptureJournal now refuses transfer histories at intake and completion with TRANSFER_BUNDLE_REQUIRED, closing the single-stream bypass. Existing immutable historical records are not rewritten.

The store binds source identity, pair of streams and replay/adapter build, enforces prefix/watermark immutability, persistent deduplication, a sixteen-bundle trial limit, content/result hashes, single-writer locking, private file permissions and verified local snapshots. Pending bundles remain unavailable through acknowledged(). The trial cap is not a production retention policy. Acknowledgement means complete hypothetical comparison evidence, never actual cooking/driving or a verified capacity decision.

## Validation performed

- Export-only private PostgreSQL fixture acceptance passed inside BEGIN/ROLLBACK: two histories and receipts returned; STABLE/invoker metadata checked; third-stream closure refused; disabled stream refused. Fixture rows were explicitly seeded synthetic export data. This is not a repeat of the booking mutation trial or a simultaneous writer test.
- Actual export retained in fixtures/cross-date-bundle-staging-export.json and consumed by the Node/Python gate tests. Two transfer pairs and both histories replay successfully.
- Missing counterpart/receipt, duplicate receipt, inconsistent event clock, outside stream, rewritten history and target mismatch (including a one-microsecond mismatch) are refused.
- Forced second-watermark intake failure rolls back BOTH histories and the new bundle.
- Forced failure after BOTH comparisons leaves the bundle PENDING, no visible acknowledgement, and an identical retry succeeds without duplicates. Restart, deduplication and local snapshot integrity checks pass.
- The previous actual mutation captures also pass through the new bundle store; the single-day journal refuses them.
- 183 core Node tests pass in London and UTC, 17 focused staging tests pass in each timezone, and 65 Python event tests pass. Final target-precision gate checks also pass in both timezones.
- Cleanup verifies export_transfer_pair() and booking_transfers absent, zero fixture streams. No staged Railway or production changes were made in this step; no Railway mutation was requested.

## Next bounded authenticated trial

Install matching source transfer definitions, moved-row guards and export function only in private staging, with the runtime disabled first. Add narrowly scoped receipt SELECT/INSERT policies/grants for the existing writer and SELECT for the reader, limited to enabled synthetic streams; the reader must never receive move-function EXECUTE or event writes. Then test two authenticated connections, opposite-direction moves, and normal actions using the fixed reader and bundle acknowledgement path.

Only exactly two non-empty streams are supported here. Wider connected histories or empty-stream acquisition must remain unverified until supported, rather than silently omit data. The future controller must route TRANSFER_BUNDLE_REQUIRED to this path and monitor acquisition failure/freshness separately; a previously acknowledged historical bundle does not prove a fresh successful poll.

Local snapshot recovery is tested. Independent cloud recovery and backup inclusion of transfer receipts/bundles and planning evidence remain required before relying on the new path for production capture. Full live-writer coverage and the initial production baseline remain separate rollout dependencies.

Reference: [PostgreSQL function volatility and statement snapshots](https://www.postgresql.org/docs/current/xfunc-volatility.html).
