# Offline joint kitchen adapter — 17 October 2026

Implemented in master-wok-delivery-kitchen.js. No live runtime files, source data, booking decisions or deployment configuration changed. Nothing pushed or deployed.

createDeliveryKitchenAssessment(snapshot, {timeoutMs}) returns a synchronous callback for recommendDeliveryRuns(input, {assessKitchen}). It classifies the actual menu baskets and schedules all candidate deliveries in ONE call to the conservative Master Wok engine. It returns the model's cooking finish times, rather than assuming food finishes at loading time. The delivery planner counts any resulting holding time against the 20-minute food-to-door limit.

Snapshot contract:

```js
{
  basis: 'HYPOTHETICAL_KITCHEN_OCCUPANCY',
  complete: true,
  asOfMinute: 1090,
  fixedAllocations: [{orderId: 'collection_1', start: 1080, finish: 1090}],
  orders: [{orderId: 'delivery_a', lines: [
    {itemId: 'panang-curry', qty: 1, mods: [{id: 'chicken'}]}
  ]}]
}
```

Minutes refer to the service's local clock, within 16:30–22:00. This API does not infer a date, timezone conversion, order acceptance or actual cooking from clock values. A future snapshot builder must bind the snapshot, delivery input and route estimates to the same service date and assessment instant. asOfMinute must represent the decision instant, or kitchen opening for an earlier decision.

The caller must supply complete hypothetical kitchen occupancy, including collections, existing delivery cooking and any unavailable kitchen time. Every existing allocation stays fixed, even future ones. Overlapping blocks, duplicate IDs, proposed IDs already in the fixed plan, invalid baskets and incomplete proposals fail closed. Unknown coverage, invalid input, VM timeout or exhausted search returns UNVERIFIED. The adapter does not independently prove the caller's completeness assertion or reconstruct a snapshot from saved order rows. Only new candidate baskets are classified here; existing allocations must come from a separately validated kitchen plan.

FIT means a hypothetical joint cooking plan was found. It remains verified=false with evidenceBasis=HYPOTHETICAL_KITCHEN_PLAN_NOT_COOKING_ACTIVITY. NO_FIT describes this fixed-plan search; it is not proof that rearranging existing bookings could never work. The adapter deliberately does not rearrange commitments. The legacy engine favours early feasible cooking; it does not search all possible finishes to optimise delivery food age. A rejected food-age result can therefore be conservative. Normal kitchen holding remains ten minutes; the delivery food-to-door limit remains twenty.

Six new tests cover independent fits versus joint failure, collection conflicts and exact boundaries, malformed/incomplete coverage, duplicated or incomplete proposals, mutation isolation and actual cooking finish times, and delivery search through the real engine. Full verification: 59 Node runner entries pass in Europe/London and UTC, and 56 Python tests pass. Test logs are included.

Next: build and validate a complete snapshot adapter; capture timestamped directional duration estimates for all deliveries including free ones; agree loading/handover/minimum saving allowances; exercise this in staging. Current production shadow remains on its approved kitchen-only runtime. Any production update requires explicit approval after review.
