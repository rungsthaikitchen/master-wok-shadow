# Terminal status after a rejected proposal

20 October 2026. Candidate implementation and staging trial. Production remains unchanged.

The private staging booking wrapper previously always emitted RESERVATION_RELEASED for cancellation/completion. After rejection had already removed the provisional reservation, record() correctly refused that release, preventing the terminal order status from being saved.

The candidate emits ORDER_STATE_CHANGED (CANCELLED or COMPLETED) when the order has no current reservation. An active reservation still requires RESERVATION_RELEASED. The source and replay require known order history, reject status-only closure while capacity is held, and prevent a closed order being reserved again. Repeated identical command IDs retain existing idempotency. No cooking activity is inferred from completion status.

Changes cover the chronological validator/replay, local transactional source, private staging source SQL, and production-shaped private staging booking wrapper. The older synthetic handle() harness is unchanged; this candidate does not claim complete coverage of every mutation path.

Validation:
- Existing Node suite: 166 passed in Europe/London and 166 in UTC.
- Focused replay suite: 9 passed in each timezone, including the actual staging export.
- Event Python suite: 55 passed, including forced rollback, retry and journal replay of status-only closure.
- Private staging PostgreSQL transaction: two complete create/offer/reject/terminal lifecycles, matching retries, no reservations, unknown-order refusal; eight events exported and replayed, two hypothetical assessments, zero remaining commitments.
- Initial management acceptance rolled back all candidate SQL definitions and fixtures. Follow-up query found zero fixture streams and ORDER_STATE_CHANGED absent from the installed record() definition. The later authenticated trial installs those two functions only in private staging; see results below.

Database acceptance used project hvrqgufqjslvgiohgkvu, stream e934bdd2-0f81-45c6-839f-d648642bb248, under the management connection. At that initial acceptance stage, narrow writer credentials were not exercised. The authenticated run below subsequently exercised this candidate with the existing credentials and unchanged grants.

Review/deployment sequence:
1. Review record() in schema.sql and apply_booking() in booking-store.sql together. For an existing staging installation replace these function definitions only; do not rerun CREATE TABLE setup.
2. In a single BEGIN/ROLLBACK transaction, load both CREATE OR REPLACE FUNCTION definitions and run order-state-change-acceptance.sql. This was the acceptance procedure used here.
3. Before installing/enabling the candidate, update the disabled staging consumer to the matching event contract and repeat the bounded authenticated writer trial. Existing disabled service remains pinned to its previous code and rejects this new event kind.
4. Keep production unchanged. Delivery/cross-date lifecycle handling and remaining live mutation paths still need separate integration work and review.

The new event changes source identity/build checks. Use a fresh journal for the candidate trial; never mix it into an identity-bound journal from the previous build.

## Bounded authenticated trial candidate

event_terminal_http_trial.py is disabled unless MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED=true, all other runtime/trial flags are explicitly false, and an explicit deadline is within ten minutes. Each outbound request checks the deadline. A persistent dedicated budget caps the run at twelve writer attempts and one export. Stream 682fa56b-34ea-4ce5-bf91-324a95075c02 and /data/terminal-http-682fa56b are fixed; previous budgets are not reset. The loopback HTTP server has no public domain. Two fixed synthetic collection baskets exercise rejection followed by cancel/complete, exact terminal retry, and late acceptance refusal. Expected export: eight events, two hypothetical comparisons, no remaining reservations. No cloud backup/provider calls are enabled.

## Authenticated staging result — passed

- Deployed code: 6b3ad7c56b82bfef1bfba8a621aaf0c9b6c784e9.
- Disabled preflight deployment a0bdd96a-15d2-40d6-a114-524cfbf3527d: SUCCESS, DISABLED/sourceRequests=0 at 07:14:47 UTC.
- Private staging record()/apply_booking() replacements installed atomically; existing ACLs retained. New stream initially disabled, then enabled only for the bounded run.
- Trial deployment 6c7917ed-cc66-424a-93f7-3bf4af13f47f: SUCCESS. At 07:18:35 UTC, OBSERVED/QUEUED/RECORDED, observations=2, attempts={reader:1,writer:12}, httpCalls=12, verified=false.
- Two authenticated restricted-writer lifecycles completed through loopback bearer-authenticated HTTP and PostgreSQL over pinned TLS. Each created an order, proposed a replacement, rejected it, cancelled/completed, retried the terminal command identically and refused a late acceptance.
- Eight command receipts and eight immutable source events; both duplicate retries and both refused late responses added no events. No reservations remain.
- Final booking rows: synthetic-terminal-1 cancelled, synthetic-terminal-2 completed. Both retain preferred=17:00Z and proposed=18:00Z as metadata, with confirmed time/proposal token null. No kitchen activity claim follows from those statuses.
- Actual source export saved in fixtures/order-state-change-authenticated-capture.json. Independent local replay and timezone tests pass: eight events, two hypothetical assessments, zero remaining commitments, verified=false.
- Source disabled after trial; follow-up found enabled=false, event_count=8, reservations=0 and zero enabled streams across the private source schema. Evidence retained, not deleted.
- Cleanup deployment 1b7fcc1d-2561-4ecd-ad02-e6b73f208c20: SUCCESS, default event_runtime_staging.py start command restored, DISABLED/sourceRequests=0 at 07:26:17 UTC. No pending Railway changes. Trial flag false and deadline reset to zero.
- No services, domains, volumes, buckets or privileges added. Production services/database were not changed. Private staging function replacements remain installed; this is not a production migration.
- Security advisor found no new event-store findings. Two pre-existing informational no-policy findings remain on intentionally private delivery-test tables: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy . No policy or grant was widened to silence these.

Next integration gaps remain delivery timing, cross-service-date moves and complete coverage of live mutation paths. The private staging event store is not yet evidence that production decision history is captured completely.
