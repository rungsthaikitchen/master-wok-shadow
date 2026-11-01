# Master Wok — minimum safe launch integration contract

Status: **staging review only**. This is an implementation checklist, not permission to enable bookings.

**1 November update:** The joined runtime now covers atomic checkout/lifecycle,
protected plans, durable drain, notifications, server delivery validation and
basket-specific read-only availability through the time picker. 53 real private
PostgreSQL scenario groups pass; a mobile browser reached deployed Railway and
Supabase for availability and checkout. See PRODUCTION-LAUNCH-STATUS.md and
STAGING-FULL-MENU-RESULT.json for current gates and precise evidence limits.
The original checklist below remains the acceptance contract, not a claim that
those components are absent. Production authority remains disabled; realistic whole-service rehearsal,
real-provider/hosted Cloudflare tests, hosted write-fence certification and
full rollback are still release gates. Legacy remains authoritative.

## Existing proven boundaries
- `master-wok-transaction-writer.js` obtains a per-service-date PostgreSQL advisory transaction lock before reading commitments and assessing the candidate.
- Two independent staging connections passed a simplified reservation concurrency test.
- `staging-booking-mode.js` defaults to LEGACY; prototype diagnostics cannot authorise booking.
- Offline combined wok/fryer/lead-time replay has 42 provisional fits on the current Friday fixture, with `bookingApprovalAllowed=false`.

## Critical gaps to close, in order

1. **Single atomic checkout write.** The reviewed production browser writes `orders` and `order_items` separately. Introduce one server-side booking endpoint or database function that locks, reads, assesses and inserts header/items/idempotency together. Browser must not bypass it. Do not modify production until explicitly approved.
2. **Real candidate representation.** The current `bookStagingCandidate` receives a classified candidate but the cross-order/fryer prototypes require raw `items`, modifiers, placement time, and ready minute. Construct and validate a canonical candidate row *inside the locked transaction*; reject missing or unsupported lines.
3. **Joint physical feasibility.** `scheduleCrossOrderPanang` and `plan` are currently independent prototype allocators; fryer cycles depend on wok starts, but no joint search/verification exists. The fryer greedy planner can report UNVERIFIED on feasible arrangements. Chef attention, non-spring-roll starters and certain fried items remain unmodelled. Do not treat prototype fit as booking GREEN.
4. **Full lead-time path.** Current combined report derives lead time from candidate wok jobs only. Candidate frying can start earlier; evaluate earliest candidate fryer/wok work through final candidate completion, including the agreed buffer, and apply cold fryer readiness conservatively.
5. **Availability and order lifecycle.** Respect customer opening times (17:00–21:00), internal production (16:30–22:00), blackouts, existing orders, changes, cancellations, test flags and time acknowledgements in the authoritative locked state.
6. **Launch certification and rollback.** End-to-end staging tests for two real baskets, conflicting orders, rollback, retries, blackouts and time changes. Only then add a trusted server-side launch flag, with legacy fallback and explicit cutover approval.

## Explicit non-goals
No new chef confirmations, kitchen tablets, dashboards, or RestaurantOS redesign. Keep existing customer UI where possible.

## Important safety rule
Do not convert `PHYSICAL_FIT_PROTOTYPE`, `FRY_PLACED_PROTOTYPE`, or `PROTOTYPE_FIT_LEAD_AND_COLD_FRYER_ONLY` into `GREEN` merely to satisfy the booking-mode gate.

