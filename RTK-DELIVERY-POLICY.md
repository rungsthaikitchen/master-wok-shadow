# RTK delivery shadow assumptions — approved 17 October 2026

David approved two minutes from food ready to departure, two minutes per customer's doorstep handover and a minimum five minutes saved before recommending a combined delivery. Doorstep arrival remains within ±10 minutes of the requested time. Food ready to doorstep remains capped at twenty minutes, with strictly under fifteen preferred.

Loading includes remaining bagging, attaching itemised and allergen receipts, placing food in the insulated transport bag, checking/entering the address in navigation and the short walk to the car. Bagging may happen progressively as items become ready, but the model does not deduct this allowance or assume navigation was already entered. For the current one/two-order planning scope, the run loading allowance is two minutes; unusual larger packing workloads need an explicit reviewed exception rather than silently extending the model to arbitrary numbers of orders.

The machine-readable policy is master-wok-rtk-delivery-policy.json. The RTK entry point is assessRtkDeliverySnapshot in master-wok-rtk-delivery-assessment.js. It applies these values over any stale example allowances, without mutating input, and remains disabled unless enabled is explicitly true. It is for offline/staging review, not a production activation. Generic low-level APIs retain explicit caller-supplied values for other restaurants/tests; use the RTK entry point for this approved profile.

The minimum five-minute saving is strict, including cases where the generic planner would combine solely to improve freshness. If the selected combined alternative does not demonstrate the saving, the RTK profile uses a feasible separate alternative. If no separate baseline exists, it reports UNVERIFIED rather than inventing a saving. This is conservative: it may withhold a feasible shared run pending human review. It never changes a live booking.

The integrated synthetic example now uses these agreed values. Two 19:00 targets produce A at 18:55 and B at 19:00, depart at 18:47 and return at 19:09. Cooking finishes at 18:35 and 18:45. Food-to-door ages are twenty and fifteen minutes respectively, both ACCEPTABLE_FLAGGED. The shared run occupies twenty-four driver minutes compared with forty for the selected separate alternative, saving sixteen. This is a synthetic conservative kitchen plan, not actual cooking or measured travel. The under-fifteen preference is not met in this example; reaching the cap is reported clearly.

Fixtures: integrated-two-stops-input.json and integrated-two-stops-result.json reflect the new values. rtk-approved-policy-result.json additionally records policy provenance. The older two-nearby-stops fixtures deliberately remain historical synthetic callback examples, not the current RTK operating profile.

Outstanding staging dependencies remain the real route provider and complete validated source of kitchen/driver plans. Customer addresses, credentials and paid routing calls have not been accessed for this update. Production observer and checkout are unchanged.

Validation: 86 Node runner entries pass in Europe/London and UTC; 56 Python tests pass. The profile tests cover disabled operation, applied handling allowances, immutable input, unknown coverage and refusal to invent the five-minute saving.
