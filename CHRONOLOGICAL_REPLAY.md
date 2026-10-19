# Chronological kitchen replay

`master-wok-chronological-replay.js` is a default-off, offline event reducer and kitchen comparison. It has no database, routing, network, persistence or live booking hook. This version expands coverage from a single earliest order to every recorded booking decision in a bounded event stream. It does not implement all-order delivery route optimisation.

## Evidence contract

Input is `{serviceDate, coverage, events}`. `serviceDate` is the London service date. Coverage has exactly:

- `basis: "DECISION_EVENT_LOG"`, `complete: true`.
- `initialState: "NO_PRIOR_SERVICE_COMMITMENTS"`. The export must include advance commitments, not merely events created on the service date.
- `eventCount`, `firstSequence: 1`, `lastSequence: eventCount`.
- `throughAt`: explicit-offset timestamp bounding the complete exported interval.

These are assertions the eventual exporter must prove. Sequence/count checks detect internal gaps and duplicates; they cannot prove that the source omitted no event. The current saved Supabase order rows cannot satisfy this contract by themselves. Never generate these markers by renumbering an arbitrary saved-state export or fabricating decision times.

Each event has a pseudonymous `eventId`, contiguous positive `sequence`, explicit-offset `at`, and `kind`. Source order must come from an authoritative persisted sequence, not sorting UUIDs at tied timestamps. The reducer sorts by sequence and refuses a timestamp reversal. All event clocks must fall on or before the service date in London, including advance bookings from earlier dates.

| Kind | Additional fields | Effect |
| --- | --- | --- |
| `RESERVATION_SET` | `order`, `commitment: PROPOSED or CONFIRMED` | Update the effective commitment. A new proposal replaces the previous target immediately, including a prior confirmation. |
| `BOOKING_DECISION` | `order`, `actualDecision: ACCEPTED, DECLINED or SUGGESTED` | Assess against other then-known commitments, then apply the recorded decision. ACCEPTED confirms; SUGGESTED replaces the previous reservation with a provisional reservation; DECLINED retains any previous commitment. |
| `RESERVATION_RELEASED` | `orderId`, `reason: CANCELLED or COMPLETED` | Release a known commitment only when a recorded cancellation/completion says so. |

An `order` has exactly `orderId`, `orderType`, `targetAt`, `lines`, `deliveryReadyEstimate`. Lines have exactly `itemId`, positive integer `qty`, `mods`; each modifier has only `id`. Use the existing pseudonym mechanism before export. No customer names, addresses, coordinates or contact details belong in this input or output. The sample fixture uses invented identifiers and menu baskets only.

Collection targets are food-ready targets. Delivery targets are customer-arrival targets. For a delivery, `deliveryReadyEstimate` is either null or `{foodReadyAt, estimatedAt, basis:"DELIVERY_PLANNER_ESTIMATE"}`. Its assessment time must be no later than the event, no older than thirty minutes at the assessed decision, and food-ready-to-arrival must be between two and twenty minutes inclusive. Missing/stale estimates produce UNVERIFIED for decisions depending on that delivery. The replay does not invent travel times or check driver return availability; those remain the delivery planner's separate responsibility. The ideal under-fifteen-minute target is not claimed validated by this kitchen-only assessment.

## Safety and limits

- The entire stream is structurally validated before assessment. A gap, duplicate, unknown release, future estimate, extra private field or bad timestamp fails closed. No partial successful report is returned on fatal errors.
- Later reschedules cannot alter earlier observations. Proposed reservations are included when they are the effective commitment, and model results never decide which recorded orders enter the subsequent state.
- Same-clock prior commitments produce UNVERIFIED because the current kitchen adapter cannot represent authoritative sequence ordering at identical millisecond timestamps. The replay does not manufacture a timestamp to force an answer.
- A replacement excludes the order's previous version from its own pre-decision reservations, preventing self-conflict.
- Kitchen schedules remain hypothetical, not evidence of actual cooking/driver activity. Every result has `verified:false`; the overall `REPLAYED` status means the event stream was processed, not that all bookings were feasible.
- The existing adapter uses Europe/London; running the default assessor in another process timezone yields UNVERIFIED. The CLI example explicitly uses London; tests also run a London subprocess under UTC parents.
- Maximum 1,000 events, 100 lines per basket, 100 units per line, 30 modifiers per line, five MiB JSON, and a default thirty-second replay budget. The kernel adapter separately bounds search and reservation count. Unknown assessment details are redacted.

## Offline use

The module exports `replay(input,{enabled:true})`. The standalone command accepts bounded JSON on stdin, and exits without reading it when disabled:

```sh
TZ=Europe/London MASTER_WOK_EVENT_REPLAY_ENABLED=true node master-wok-chronological-replay.js < fixtures/chronological-synthetic-service.json
```

This command is documentation, not a request for the owner to run diagnostics. The integration tests run it automatically.

## Backend requirements before live comparison

1. Capture successful booking decisions, suggested times, customer confirmations, cancellations and completions with the state known at that moment. Read final rows only for clearly labelled saved-state approximations.
2. Produce a durable monotonic sequence with stable event IDs. Retried delivery must be deduplicated before export. Include advance bookings and mark any missing events or unknown interval as incomplete.
3. Bind the coverage watermark and event batch to the same consistent source snapshot; detect truncation. A capture outage cannot be relabelled complete when polling resumes.
4. Keep capture asynchronous and independent of availability/checkout responses. Do not await engine assessments in the request path. A durable source outbox would need separate approval for any production database writes; none are performed or enabled by this patch.
5. Feed delivery-ready estimates from a versioned, as-of delivery planner with documented route provenance and the agreed loading/return constraints. Arrival times alone are insufficient.
6. Persist redacted per-decision comparisons only in the shadow store, bound to engine/source revisions and coverage. A live decision stays live regardless of the hypothetical recommendation.

The existing server-side observer and event/outbox components need concrete backend integration review before this module receives live events. No production deployment, schema update or instrumentation was performed as part of this offline replay work. Existing deployed staging fixtures remain disabled.

For the new receiving inbox and background comparison worker, see EVENT_CAPTURE_INTEGRATION.md. This remains synthetic staging integration; it does not create the authoritative source event log.

## Offer responses (staging contract)

`PROPOSAL_RESPONSE` has exactly `eventId`, `sequence`, `at`, `kind`, `orderId`, `proposalEventId`, and `response` (`ACCEPTED` or `REJECTED`). The referenced event must be that order's current `PROPOSED` reservation or `SUGGESTED` decision. Acceptance changes only its commitment to confirmed, retaining the offered target and reservation clock. Rejection removes it without restoring any superseded target. A stale, unknown, duplicate or already-cancelled response invalidates the batch before assessment. Source retries with the same event ID/content are deduplicated before append.

An offer event ID is the minimal proposal revision token; no extra mutable proposal record is needed in this synthetic contract. Repeat offers supersede earlier IDs. `BOOKING_DECISION: DECLINED` remains an admission decision, not a customer's rejection of an offer. Explicit `RESERVATION_SET: CONFIRMED` remains available for authoritative admin events; customer responses must use `PROPOSAL_RESPONSE`. No automatic expiry or inferred release is implemented. A future expiry policy requires its own version-bound event and explicit expiry evidence.

These changes affect only offline replay and the local synthetic source. Existing production checkout, Supabase functions and polling adapters retain their current behaviour pending separately reviewed integration. Replay build hashes distinguish new assessments from prior persisted results; captured source events remain immutable.

Validation, 19 October 2026: 166 Node tests pass with TZ=Europe/London and 166 with TZ=UTC. All 240 Python tests pass on the final full run (79.899s). The first parallel run had one unchanged delivery-worker shutdown test exceed its five-second shutdown allowance; it passed in isolation and on the full rerun. Four source tests include response rollback and export into the durable inbox/replay worker. No remote deployment or production database mutation was performed.
