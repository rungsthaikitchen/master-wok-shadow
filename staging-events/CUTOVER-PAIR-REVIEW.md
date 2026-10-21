# Cutover of two connected service dates

21 October 2026. Private synthetic staging candidate, installed and checked under rollback in hvrqgufqjslvgiohgkvu. Production was not written, no runtime grant was added and no Railway deployment was attempted in this change. The Railway write-authentication blocker remains unresolved; it was not retried during this work.

## Result

`seed_cutover_pair(source_a,destination_a,source_b,destination_b,request)` now seeds exactly two closed connected service streams in one transaction. Both destinations start empty and inherit their corresponding service date. The producer takes all four stream locks in UUID order before inspecting bookings or transfer receipts, captures one real server timestamp for both baselines, copies the private projections and command receipts and retires both sources. Either all changes commit or all roll back.

Mappings are canonicalised by source UUID. An exact retry, including arguments supplied in the opposite pair order, returns ALREADY_RECORDED. A changed mapping or conflicting request fails. Completed/declined reservations do not reappear as active holds. A moved row must have one matching current owner with the same pseudonymous identity and basket. A booking cannot be held on both service dates. The original preferred time can belong to the earlier date; the baseline uses the authoritative current offered/confirmed target from the matching reservation projection.

Old transfer receipts keep their original source and destination IDs and remain with the frozen history. The new pair begins with two saved-state baselines and no transfer decisions. A response to the current pre-cutover offer still works. A subsequent date move produces one new matching outgoing/incoming event pair, clears the destination delivery estimate as before and is the only move compared in the new history. Retrying an old transfer against remapped stream IDs is refused before mutation; it cannot silently become a second booking.

## Closure and validation

Sources linked to a third stream are refused, including links to a disabled stream. Receipts require both counterpart events. The receipt, source/destination service dates, order identities, event IDs, sequence fields, event times and target must agree. Corrupted event dates and receipt targets were first demonstrated as failing regression tests, then refused by the hardened candidate. Missing baskets, unknown lifecycle states, ambiguous owners, stale revisions, non-empty destinations and incomplete mappings also fail atomically.

Snapshot validation is shared through `cutover_snapshot`. The single-stream producer now uses the same helper and continues to refuse connected transfer histories. The helper is explicitly VOLATILE and reads under the seeding caller's stream locks; the consistent reader exporter remains STABLE. PostgreSQL documents the relevant fresh-query snapshot behaviour here: https://www.postgresql.org/docs/17/xfunc-volatility.html . Actual multi-session lock behaviour still needs the blocked direct-connection rehearsal.

Each source retains the earlier bounds: at most 1,000 booking rows, 500 holds, 100 lines per basket, 30 modifiers per line and 100 KB baseline JSON. The downstream paired export/receiver still impose their existing limits. Missing delivery estimates remain missing. Existing estimates keep their exact evidence timestamp, and tests confirm an older estimate is neither refreshed nor carried onto another service date. All kitchen and delivery plans remain hypothetical.

All new functions are SECURITY INVOKER with fixed search_path. PUBLIC, anon, authenticated and service_role have no execution grant. Hosted checks confirm neither existing restricted reader nor writer can call the snapshot/pair-seed functions or update streams.enabled. This remains an administrative synthetic source prototype, with no production triggers, browser RPC, order decision hook or router switch.

## Hosted checks and durable evidence

The following private staging migrations succeeded:

- master_wok_private_shared_cutover_snapshot
- master_wok_private_single_cutover_shared_validation
- master_wok_private_two_day_cutover_candidate
- master_wok_private_pair_cutover_receipt_binding

`cutover-pair-hosted-acceptance.sql` executed successfully after hardening. It creates four temporary synthetic streams and current bookings, moves one order forward/back/forward before cutover, tests full rollback after a successful seed, refuses a partial basket and missing/mismatched history, then captures the successful pair. The enclosing transaction rolls back every fixture write. It also verifies acceptance without a second reservation, stale response refusal, a new return move, completion of a known unreserved order, conflicting legacy retry refusal and an exact seed retry.

The final hosted capture boundary is 2026-10-21T08:03:46.549995Z. `fixtures/cutover-pair-staging-captures.json` contains the actual initial/final exports. It is entirely synthetic, with generated fixture stream IDs and no customer information. Initially both streams contain one baseline, zero new transfer receipts and three held reservations in total. The final export contains six events across both streams, exactly one prospective transfer and three remaining holds, distributed two/one by service date. Three pre-cutover moves remain outside prospective decision counts.

The real SQLite paired store ingests these exports, acknowledges baseline-only intake with zero comparisons, refuses changed baselines and mixed snapshots, rolls back an injected failure before final ACK, reopens and retries, and reopens a consistent restored snapshot with both ACKs intact. Removing baseline provenance from one worker result prevents either side acknowledging that bundle. These checks use the real Node replay worker. They do not establish an actual process-kill or provider object-storage rehearsal for this new producer; those existing capabilities remain separate evidence.

The hosted single-stream rollback/lifecycle scripts were rerun successfully after extraction of the shared helper. A final global read confirmed zero enabled streams and zero active reservations. Security advisors still report only the two pre-existing INFO notices for inaccessible private delivery test tables with RLS and no policies: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy . No permissive policies were added.

## Validation and next steps

All 191 core Node tests pass in Europe/London and UTC. The staging suite has 58 passing test entries in each timezone, including the single/pair PL/pgSQL tests and actual hosted export checks. All 90 Python event tests pass, including the two new paired-baseline durability tests. No cases are skipped.

The work closes the source-producer gap for a closed pair of service dates. Remaining dependencies are explicit:

1. Real simultaneous PostgreSQL writer/seed tests through the existing Railway staging service. Write authentication is still blocking deployment of the already prepared witness. No further reconnect loop or permissions expansion was attempted.
2. Command-router and observer identity handover, plus a complete provider recovery rehearsal using the new source baseline. The observer never seeds or writes bookings.
3. Components spanning more than two connected dates. The present candidate refuses them; it does not partially cut them over.
4. Complete deployed production writer coverage, including the still-unretrieved customer-response function/backend revision and checkout's separate order/item writes. A private complete marker does not prove production capture completeness.
5. A separately reviewed production capture diff and representative quiet/steady/busy observations. Production scheduling/checkout remains unchanged.
