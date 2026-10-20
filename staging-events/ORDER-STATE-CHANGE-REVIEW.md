# Terminal status after a rejected proposal

20 October 2026. Review candidate only; no running service or permanent database definition changed.

The private staging booking wrapper previously always emitted RESERVATION_RELEASED for cancellation/completion. After rejection had already removed the provisional reservation, record() correctly refused that release, preventing the terminal order status from being saved.

The candidate emits ORDER_STATE_CHANGED (CANCELLED or COMPLETED) when the order has no current reservation. An active reservation still requires RESERVATION_RELEASED. The source and replay require known order history, reject status-only closure while capacity is held, and prevent a closed order being reserved again. Repeated identical command IDs retain existing idempotency. No cooking activity is inferred from completion status.

Changes cover the chronological validator/replay, local transactional source, private staging source SQL, and production-shaped private staging booking wrapper. The older synthetic handle() harness is unchanged; this candidate does not claim complete coverage of every mutation path.

Validation:
- Existing Node suite: 166 passed in Europe/London and 166 in UTC.
- Focused replay suite: 8 passed in each timezone, including the actual staging export.
- Event Python suite: 53 passed, including forced rollback, retry and journal replay of status-only closure.
- Private staging PostgreSQL transaction: two complete create/offer/reject/terminal lifecycles, matching retries, no reservations, unknown-order refusal; eight events exported and replayed, two hypothetical assessments, zero remaining commitments.
- All candidate SQL definitions and fixtures were rolled back. Follow-up query found zero fixture streams and ORDER_STATE_CHANGED absent from the installed record() definition.

Database acceptance used project hvrqgufqjslvgiohgkvu, stream e934bdd2-0f81-45c6-839f-d648642bb248, under the management connection. Narrow writer credentials were not exercised for this candidate. Existing grants are unchanged. The prior authenticated HTTP test remains evidence for the previous deployed revision only.

Review/deployment sequence:
1. Review record() in schema.sql and apply_booking() in booking-store.sql together. For an existing staging installation replace these function definitions only; do not rerun CREATE TABLE setup.
2. In a single BEGIN/ROLLBACK transaction, load both CREATE OR REPLACE FUNCTION definitions and run order-state-change-acceptance.sql. This was the acceptance procedure used here.
3. Before installing/enabling the candidate, update the disabled staging consumer to the matching event contract and repeat the bounded authenticated writer trial. Existing disabled service remains pinned to its previous code and rejects this new event kind.
4. Keep production unchanged. Delivery/cross-date lifecycle handling and remaining live mutation paths still need separate integration work and review.

The new event changes source identity/build checks. Use a fresh journal for the candidate trial; never mix it into an identity-bound journal from the previous build.

## Bounded authenticated trial candidate

event_terminal_http_trial.py is disabled unless MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED=true, all other runtime/trial flags are explicitly false, and an explicit deadline is within ten minutes. Each outbound request checks the deadline. A persistent dedicated budget caps the run at twelve writer attempts and one export. Stream 682fa56b-34ea-4ce5-bf91-324a95075c02 and /data/terminal-http-682fa56b are fixed; previous budgets are not reset. The loopback HTTP server has no public domain. Two fixed synthetic collection baskets exercise rejection followed by cancel/complete, exact terminal retry, and late acceptance refusal. Expected export: eight events, two hypothetical comparisons, no remaining reservations. No cloud backup/provider calls are enabled.
