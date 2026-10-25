# Current checkout field mapping — 25 October 2026

The default-off offline adapter preserves the complete **currently submitted** order/item payloads and prepares a separate engine allowlist. It neither persists nor transmits data. No website/backend/Edge deployment, production write, staging grant or scheduling change was made for this mapping stage. The previous hosted submission rehearsal remains disabled.

Website commit `55938bc73cd762be614a300ef54bacaedda5f6b0` was rechecked and remains current in GitHub. Production orders/order_items column metadata was read using SELECT only; no customer/order rows were queried. Source expression excerpts and their SHA-256 hashes are in `fixtures/checkout-source-shapes-25-oct.json`; the earlier full-file Git blob matches establish provenance. Repository source is not a serving-revision or traffic guarantee.

## Mapping contract

The main checkout sends 25 distinct order keys and nine item keys. Both retained refactor pages send 20 order keys and eight item keys. `checkout-production-field-map.json` enumerates every field for each page and all database columns outside those checkout payloads. `fixtures/checkout-column-contract-25-oct.json` contains the reviewed column types/nullability, without table data.

| Fields | Private prepared write | Engine preparation |
| --- | --- | --- |
| customer_id, order_ref, notes | Exact original values | Excluded; the caller supplies a synthetic staging order alias |
| subtotal, discount, delivery_fee, total | Exact values; no rounding or recalculation | Excluded |
| discount_code, discount_amount, discount_label | Retained independently; missing older-page fields stay absent | Excluded |
| loyalty_discount, loyalty_points_redeem_pending, loyalty_points_earned_pending, loyalty_reward_applied, loyalty_expected_balance, loyalty_settled | Exact values, including null/false/zero; no settlement or balance update | Excluded |
| delivery_straight_line_miles, delivery_route_miles, delivery_distance_source | Exact values, including explicit zero/null | Never converted into journey duration or food-ready time |
| order_type, preferred_time, asap_requested | Preserved without normalization or target changes | Type/requested target only; ASAP, missing or invalid targets produce no engine projection |
| payment_preference, communication_preference | Retained without changing defaults | Excluded |
| idempotency_key | Retained as the request binding | Excluded; no key is generated here |
| item order_id | Must match the supplied proposed order UUID | Excluded |
| item_id, qty, modifiers.id | Preserved in ordered item rows | Copied into the engine basket allowlist |
| name, unit_price, modifiers.name, modifiers.delta, spice, img, kitchen_load | Preserved when supplied by that source page | Excluded; modifier prices are not added to unit price again |
| optional item_note | Preserved only when explicitly supplied | Excluded; it is not invented from order notes |

Order status, confirmed/proposed times, tokens, generated IDs, payment state, notification state and the other database columns outside the source shape are not silently accepted as browser checkout fields or filled with guessed defaults. Other producers/database defaults remain responsible for them. Unknown fields fail preparation instead of being discarded. JSON types, field sets, basket bounds and order/item identity linkage are checked; these are offline mapping checks, not a new live booking policy.

`prepareCheckout` requires explicit staging project configuration and returns DISABLED before touching private input by default. With enablement, it returns a copied private snapshot, request binding and minimal engine projection with `verified:false`, `prediction:UNVERIFIED` and evidence basis `CHECKOUT_MAPPING_NOT_PERSISTENCE_OR_DECISION_HISTORY`. It has no network/database client and does not call the existing submission SQL. No API key, customer record or whole downloaded page is included in the committed fixtures.

## Existing behaviour preserved and discrepancies reported

1. Main checkout assigns discount_label twice. Its later coupon-label expression overwrites the earlier loyalty/midweek label. With no coupon this can leave a nonzero discount and null label. Tests execute the exact source expression and preserve that result; it was not corrected in live code or silently rewritten in the adapter.
2. discount, discount_amount and loyalty_discount are distinct current fields. The adapter does not guess which should be added/subtracted or change a stored total. It reports arithmetic/precision differences as diagnostics only. Matching arithmetic is not proof of an authorized server price, discount eligibility or quote validity.
3. The older pages omit coupon/distance fields and kitchen_load. The adapter preserves absence rather than inserting zero/default values. Their source also uses finalPreferredTimeISO where the main page uses preferredTimeISO; the mapper retains the actual supplied value rather than reconstructing an earlier customer request.
4. order_items supports item_note, but none of the three inspected item constructors submits it. Therefore current per-item note persistence is not established by this source. Mapping an optional future value does not fix the existing omission. Any UI/persistence change needs its own reviewed diff.
5. The submitted order holds customer_id, while customer name/contact/address are handled separately in customers. Preserving that UUID does not authenticate customer ownership or freeze the address used at booking time. This adapter neither looks up nor duplicates customer contact data. Address snapshot/location provenance and same-transaction authorization remain backend requirements.
6. Delivery miles, including free-delivery zero/null cases, do not establish travel or return time. DeliveryReadyEstimate remains null without separately bound planning evidence. No hypothetical cooking, driver activity, admission decision or event timestamp is created.

The engine allowlist is structural, not a certification that arbitrary incoming item/modifier IDs belong to an authoritative menu. Before any production export, the backend must bind a trusted menu/catalog and generate pseudonyms under its own control. Browser-supplied values or aliases do not establish that trust. This offline module is not a public customer endpoint or production anonymization authority.

## Tests and next integration

Ten mapping tests passed in Europe/London and UTC. They evaluate the exact hashed source expressions against synthetic values, retain the same JSON values for all three page shapes, reproduce duplicate-label behaviour, keep coupon/loyalty values independent, test private-field exclusion, optional note handling, missing-vs-null semantics, clone isolation, missing/ASAP/calendar-invalid targets, delivery uncertainty, unknown-field/type/order binding refusal and non-rounding monetary diagnostics. With the adjacent atomic SQL/adapter tests, 27 Node entries pass per timezone.

The previous synthetic submit_checkout accepts a smaller quote payload. Feeding this full private snapshot to that function would be incorrect and is not wired here. The next backend wrapper must persist every supported private order/item field and the engine event in one transaction, resolve authorized customer/order identity, and return a durable receipt. Its server quote/validation boundary must preserve current prices and availability during capture-only integration; a new pricing engine is not authorized by this mapping.

Browser reload recovery for the submission key remains unimplemented. Do not regenerate it merely because a success response was lost, and do not persist arbitrary private checkout data in browser storage without a reviewed retention/recovery design. Notification/loyalty settlement side effects stay outside the booking transaction and need their own deduplication receipts.

After the full wrapper and every retained writer adapter are tested in staging, review the exact production diff and capture permissions before enabling prospective event collection. `order-confirm` source and full retained-writer coverage remain unresolved. No production database-write approval or live scheduling change is inferred from the passing offline tests.
