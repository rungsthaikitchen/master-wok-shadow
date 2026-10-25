Current 25 October coverage review and the tested response/observer handover candidate: [BOOKING-COVERAGE-AND-HANDOVER-REVIEW.md](BOOKING-COVERAGE-AND-HANDOVER-REVIEW.md). Earlier evidence below is historical; production coverage remains incomplete.

# Production event capture review — 20 October 2026

Review only. No production writes, migrations, deployments, scheduling or checkout changes. The new helper snapshot and four characterization tests are isolated review artifacts; no runtime imports them. Passing tests reproduce observed discrepancies; they do not mean live behaviour is corrected.

## Evidence and limits

- Supabase production hyper-worker / order-action v30, bundle hash 789e186428a61cc9d1a197d0bb6afa1bd9e718f07d4b1ebbcf183074f474abfb, fetched read-only.
- review-order v11, bundle hash 386b29458973ba9fa09d335d813b053c56cf2af4e91ba94e305edc3e53d482d3, fetched read-only. Deployed presence does not prove it is currently called.
- Website repository index.html at cb39250cc2d1d6de03b090a8183db4ae5ba30c62, blob 1102ab8c713a0dba5a0a5df8745871ca8a2ef688. This proves repository content, not the currently served Cloudflare deployment revision.
- admin.html blob a5e5aeaad1244a69bc6e5f52dbb02122691f2b11 and order-confirm.html blob 16ff06758d560dc2207ccc0491c86fe2d6ee819f fetched from repository default branch.
- Cloudflare proxy functions/admin-api/order-action.js blob 88964efb8f384cdada1b9af600581865f81a066a forwards to Railway /admin-order-action.
- Railway order-backend reports deployment 7fb18840-8d11-441a-8c40-13abf60ee5b9 at commit 51616be77f92fcfd99958e8d784361eb232073a5, repository rungsthaikitchen/order-backend. GitHub fetch returned 404 for both default and deployed refs. Current backend source remains unverified; the uploaded server.py is reference evidence only.
- Supabase lists order-confirm ACTIVE v18. Source retrieval returned UNAVAILABLE; it must not be described as empty or assumed to match the uploaded code. The repository order-confirm.html calls it with token/decision.
- Read-only metadata found no non-internal triggers on public.orders/order_items. The current columns include three time fields but no proposal revision, offered timestamp, response timestamp or immutable event history. No customer rows were read for this review.

## Current paths and discrepancies

| Path | Observed behaviour | Capture implication |
|---|---|---|
| Website checkout | Browser upserts orders and inserts order_items separately; another insert path exists in the file, whose reachability is not established | An order INSERT alone cannot prove a complete basket or successful checkout |
| Admin action proxy | Website -> Cloudflare -> Railway -> configured Edge action; uploaded Railway code uses hyper-worker | A callback here misses direct writes and customer responses; deployed Railway target configuration still needs verification |
| hyper-worker accept | Sets status=confirmed and clears confirm_token; does not populate confirmed_time | Capture actual effective target and action, rather than equating status with a timestamp |
| hyper-worker suggest_time, non-ASAP | Sets status=proposed, proposed_time and a new token; leaves confirmed_time intact | A previously confirmed order can retain a stale confirmed target in the website helper |
| hyper-worker suggest_time, ASAP branch | Writes preferred_time, clears proposed_time, uses status=accepted | Keep this separate legacy transition; ASAP being unused does not remove deployed code |
| hyper-worker decline/complete | Sets cancelled/completed; decline clears token | Distinguish admission decline/cancellation from rejection of an offer |
| review-order | Uses review_status, time fields and payment-link operations | A second mutation contract exists; do not silently treat it as the active admin path |
| Admin direct status helper | Repository has direct orders UPDATE, including completion handling | Must be covered or proven unreachable before claiming complete capture |
| Customer responses | order-confirm Edge route plus separate Railway routes in uploaded server.py | Both need current-source/auth/version mapping; notification calls are not proof of a committed response |

The current website helper chooses confirmed_time before any proposal. Example: confirmed 18:30, new offer 19:00 -> still reserves 18:30. Your rule requires moving to 19:00 immediately. The helper releases a rejected offer only for status=pending with proposed_time and no confirmed_time. The uploaded Railway helper instead writes customer_declined_time, which the website helper can reserve at the rejected proposed time. This latter cross-component discrepancy is conditional on the uploaded backend matching deployed behaviour.

The website schedule query filters only the original preferred_time date. Moving an order across service dates can therefore omit it from the destination day. An empty result on fetch failure is also not evidence of available capacity. None of these are changed here.

## Smallest safe integration recommendation

1. Keep existing read-only saved-state monitoring running as limited evidence. Do not label polled rows as complete historical decisions or backdate revised saved times.
2. Reuse the tested private staging transaction/outbox pattern, adapting it to a production-shaped staging fixture. Use one shared, authorized database command for each lifecycle mutation: lock current order, validate request ID and expected proposal revision, update order and provisional reservation, append immutable event, then commit. Engine replay, provider calls and notifications run outside this transaction.
3. A new offer replaces the one active reservation immediately at its server event timestamp. Acceptance references that exact offer and changes commitment only; rejection/cancellation releases it. Repeat proposals invalidate earlier response revisions. Matching retries return the original result; changed payloads with the same request ID fail. Define expiry explicitly before implementing it; no default timeout is inferred.
4. Store original requested time separately from effective reservation target. A confirmed_time left on a row is not enough to identify the latest commitment. Preserve offer IDs/revisions and ordered event times. Serialize service-stream sequence/watermark assignment with commit-safe locking, including an explicit policy for cross-day moves; do not use a sequence number alone as proof that all earlier transactions committed.
5. Route every active writer through the shared transaction, or add a separately labelled row-change audit for uninstrumented writers. An audit can record that a row changed; it cannot invent who accepted, which engine decision occurred, or what basket was known earlier. Avoid a trigger that calls a remote observer or schedules food.
6. Capture order creation only after its basket is complete. Prefer atomic order+items persistence in a staging-tested submission command; until then mark partial submission evidence incomplete. Persisted bookings also omit customer attempts rejected in the browser, so comparisons with *every* live-engine evaluation need a separate decision-input/outcome capture boundary. Do not claim that lifecycle events alone cover those attempts.
7. Start coverage at an explicit cutover baseline: outstanding and advance bookings, complete basket snapshots and effective targets, identity/build version and watermark. Mark baseline rows as saved-state at cutover, not reconstructed creation events. Export pseudonymous allowlisted fields only; keep addresses, tokens, notes and customer identifiers out of replay/observations.

## Required regression checks before integration

- confirmed -> offer -> acceptance: target moves at offer time; one reservation throughout.
- offer A -> offer B -> late accept/reject A: no mutation/event; B remains current.
- concurrent accept/reject/cancel and repeat requests: one legal result and atomic outbox.
- transaction failure: neither reservation nor event commits; notification failure does not roll back an already committed booking.
- rejection with an old confirmed_time: releases latest provisional reservation without resurrecting the original target.
- cross-day offer: both source and destination service streams retain correct coverage.
- partial basket/failed item insert, item edits, completion without reservation, advance orders and cutover baseline remain explicit.
- delivery arrival targets require supported food-ready estimates; no hypothetical plan becomes actual cooking/driver activity.

Four local characterization tests passed (node --test staging-events/production-capture-review.test.cjs). They cover the first proposal, stale confirmed-time precedence and two rejection-status variants. No new live endpoint was exercised.

## Outstanding access and next change

Current deployed Railway server.py and order-confirm v18 source are needed to finish the exact handler diff. Existing credentials need not be disclosed; repository access or those source files is sufficient. Also verify the website's served revision and active call paths before retiring any legacy handler.

Next implementation: production-shaped staging fixtures and a reviewed shared transaction/adapter covering these lifecycle cases. Production mutation/capture activation remains outside this review. No additional service, bucket or paid provider is required for the next local/staging code work.

## Owner-supplied backend follow-up

The owner subsequently supplied current server(1).py, SHA-256 ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88, identical to the previous uploaded file. Backend route findings can now be prepared against that owner-supplied current source. Independent deployed commit matching and order-confirm Edge source remain unverified. See CUSTOMER-RESPONSE-ADAPTER.md for the default-off proposal-bound response preparation and source-specific findings. No production change was applied.

## 21 October: isolated legacy response characterization

While Railway builds are paused, read-only inspection reconfirmed backend deployment 7fb18840-8d11-441a-8c40-13abf60ee5b9, commit 51616be77f92fcfd99958e8d784361eb232073a5, on main with start command python server.py. Repository retrieval still returned 404 and order-confirm source retrieval still returned UNAVAILABLE. The configured SUPABASE_ORDER_ACTION_URL variable exists; its value and active target were not inspected. No deployed-source equivalence is claimed.

Seven new tests in railway-shadow/test_event_legacy_backend.py execute the exact hashed owner-supplied source with an empty import environment, mocked HTTP/database/notification modules and synthetic orders. Passing these tests confirms legacy discrepancies, not fixes:

| Reproduced case | Observed result |
|---|---|
| GET accept, no token | Updates the order; merely opening a link can mutate it |
| Matching order ID, unrelated token | Token is not validated before mutation |
| Accept PATCH fails | Customer still sees an acceptance success page |
| Neither response finds an order | Both routes still display success wording without a write |
| Cancelled row with no proposal | Acceptance still writes customer_accepted_time |
| New offer commits between lookup and PATCH | PATCH has only an ID predicate; an older target can become confirmed alongside the newer proposal |
| Decline | Updates status only; time fields remain, requiring consistent reservation interpretation |

The simulated read/write interleaving demonstrates a missing revision predicate in this source. It is not a real database concurrency test. All HTTP methods are mocks; no live endpoint, customer row or notification provider is exercised.

The smallest next integration remains the existing default-off, POST-only staging adapter plus the shared transaction: validate the current proposal revision and allowed status while holding the order lock, update the single reservation and append its event atomically, and return success only from a committed receipt. Notification failure must not change that receipt. Before replacing legacy links, establish which deployed customer-response paths are active and verify their current source. Preserve the requested original time as history, not a second reservation.

These tests deliberately remain separate from the adapter tests so a legacy reproduction passing cannot be mistaken for corrected production behaviour. No production scheduling changes, new services or provider charges were introduced.

Validation: all 97 Python event tests passed with MASTER_WOK_REVIEW_SERVER_PATH set, including the seven new legacy characterizations and existing staging adapter tests; no tests skipped. The supplied backend is loaded locally only. No runtime code changed, so the previously passed Node suites were not repeated for this test/documentation-only change.

## 23 October: deployed-commit archive comparison

The owner supplied the archive downloaded from the commit linked by the active Railway deployment, 51616be77f92fcfd99958e8d784361eb232073a5. server.py, notifications.py and requirements.txt are byte-for-byte identical to the earlier supplied files. This resolves the supplied-source mismatch dependency recorded above, based on the owner's deployment link/archive; direct GitHub connector retrieval still returns 404. Current installed dependency versions, any newer deployment, the active configured Edge action target and order-confirm source remain separate verification items. See backend-patch/SECRET-KEY-MIGRATION-REVIEW.md for hashes and the independent credential migration candidate. No live handler was invoked or changed.
