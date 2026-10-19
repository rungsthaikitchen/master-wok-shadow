# Staging handler and reader results — 19 October 2026

Private staging project only: `hvrqgufqjslvgiohgkvu`. No production schema, rows, Edge Functions, checkout or availability changes. No Railway deployment, new paid resources or provider calls.

## Implemented

`handlers.sql` adds private synthetic orders and command-idempotency tables, a server-timestamped transactional handler, and a NOLOGIN/NOBYPASSRLS reader role. `handler-decision-fix.sql` records the installed follow-up migration aligning offers/confirmations with BOOKING_DECISION SUGGESTED/ACCEPTED, so they generate comparisons. `reader-admin-membership.sql` records the grant permitting the administrative test session to assume the reader role.

`event_staging_handlers.py` supplies default-off logical admin/customer adapters with a fixed parameterized SQL call. Admin actions: offer, confirm, cancel, complete. Customer actions: accept/reject of a named current offer. Request IDs are stable across retries; conflicting command reuse fails. Project and synthetic-order aliases are checked before transport. Callers cannot provide event timestamps or baskets. The DB reads the stored synthetic basket, stamps time after locking the stream/order, records the event/reservation, updates order status and stores the command in one transaction. Notification handling is absent and cannot undo a committed action.

These are logical handlers, not installed HTTP routes or authenticated web endpoints. An injected backend transport must use an authorized staging connection; the module does not select credentials or authorize real customers. The private SQL handler is inaccessible to anon/authenticated/service_role and the reader. Neither the existing website nor Railway server imports it.

The orders payload retains original request metadata; the reservation projection is the effective offered/confirmed target. Order creation/bootstrap is owner-controlled synthetic fixture setup, not a captured production submission. Cancellation/completion currently requires an existing reservation. Full mapping for cancellation without a reservation, original pending-order capacity, delivery evidence, customer auth and cross-day changes remains necessary before real handler integration. No automatic expiry exists.

## Tests actually executed

- `handler-acceptance.sql` exercised admin confirmation, repeat offers, exact retries, stale acceptance, forced rollback of handler state/outbox/command, customer acceptance, another offer and rejection, re-confirmation and cancellation. Final stream: eight events, zero reservations, disabled.
- Current-offer acceptance produced one confirmed reservation. Repeat offers moved its target without adding a second reservation. The rollback left the order proposed and no response command stored.
- Two competing customer response queries were launched concurrently against a separate offered order. Acceptance committed; rejection failed STALE_PROPOSAL_RESPONSE. Final state: two events and commands (offer + acceptance), one confirmed reservation; stream disabled. This is one actual competing-response trial, not a stress test or proof for all transaction interleavings.
- Reader execution was tested with SET LOCAL ROLE master_wok_event_reader in a managed administrative transaction. Initial impersonation was denied until explicit membership was granted to postgres. Afterward export succeeded while current_user was the narrow role. Table INSERT, handler EXECUTE and private orders SELECT were actually attempted and denied. The reader has no LOGIN, superuser or RLS bypass; it can SELECT only synthetic stream/events objects and call the SECURITY INVOKER export. No reader credentials were created or deployed. This does not prove a standalone runtime connection/authentication path.
- That restricted-role export was imported into the real durable SQLite inbox and Node replay engine: eight events, one ACKED batch, five persisted comparisons (two GREEN/ACCEPTED, three GREEN/SUGGESTED), verified:false throughout. Repeat import was ALREADY_QUEUED. Rapid server-stamped events may share the same millisecond and must remain UNVERIFIED where the kitchen adapter cannot represent their order; do not fabricate clock offsets to force GREEN.
- New Python tests cover disabled paths, invalid action/project refusal, exact fixed commands, retries and malformed backend responses. Validation results below.

## Next rollout work

Build the authenticated staging service endpoint and restricted exporter transport, then install bounded background polling and freshness/failure monitoring on the existing staging service. Prefer an actual narrowly scoped credential/connection for the reader; do not claim the existing BYPASSRLS management reader token is equivalent. Rehearse process restart, off-volume recovery and real request authorization. All source test streams must remain disabled outside bounded tests.

Before production, present the exact integration diff for all actual admin/customer handlers and a baseline for outstanding/advance orders. Do not infer history from final saved rows. Existing production observer and checkout stay unchanged. These recommendations remain hypothetical, not confirmed cooking activity.

Validation: all 21 event inbox/source/export/handler Python tests passed in 16.820 seconds. Three newly added handler unit tests also passed independently. No Node engine code changed in this milestone.
