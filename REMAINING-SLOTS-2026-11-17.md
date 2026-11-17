# Remaining availability uncertainties — staging v84

The heavy collection basket's 19:20, 19:25 and 19:30 checks could not fit around the saved revision-6 reservations. A separate offline integer-placement diagnostic confirmed infeasibility under that preserved plan. The deployed implementation uses no solver dependency: optimistic per-vessel packing bounds, plus mandatory occupied minutes when every vessel must attain its maximum, prove these particular conflicts in roughly 1–2ms. Exhaustive small-case comparisons verify that a feasible placement is never rejected by the necessary bound. This is availability under the current preserved reservations, not a claim that staff could never rearrange future work.

The fryer planner also unnecessarily split compatible prerequisite portions by wok deadline. It can now share a batch across distinct deadlines, while keeping each allocation's deadline, attribution, not-before time and ten-minute prerequisite hold. Standalone recipes retain time/recipe grouping. Independent full meal validation remains unchanged. A shorter-travel opening delivery now validates successfully without relaxing policy.

A longer-travel 17:00 delivery still cannot fit after fryer warm-up. A bounded, optimistic early-fryer calculation now proves the capacity shortfall instead of exhausting search. It enumerates the best basket allocation of one small standalone recipe group, ignores existing reservations and recipe distinctions for prerequisites, and rejects only if even that overstated capacity is insufficient. Unsupported cases remain unverified. The 6-minute versus 7-minute synthetic-leg regression preserves a genuinely feasible boundary rather than blanket-disabling 17:00.

Hosted staging v84, 21 November, same £104.50 basket and two saved deliveries:

- Collection: 46 available, 3 KITCHEN_BUSY, zero unverified; 10.527s across four HTTP 200 batches.
- Public-landmark delivery: 38 available, 10 DRIVER_BUSY, 17:00 KITCHEN_BUSY, zero unverified; 11.312s across four HTTP 200 batches.
- These are API measurements. No claim is made about exact browser timings or a new direct diagnostic route lookup for the customer's private address.
- 412 backend tests pass, including full meal validation, every basket-line permutation, per-portion holds/deadlines and 200 exhaustive resource-bound comparisons.
- No orders, service controls or notifications were written by hosted scans. Production remains LEGACY. Deployment is staging-only and not production certification.
