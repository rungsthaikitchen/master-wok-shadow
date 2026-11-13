# Take payment and complete — staging implementation

Production is unchanged. Requires a new explicit production approval after preview acceptance.

- New `record_and_complete` action is explicit; old `record` requests keep payment-only semantics and original fingerprints, including retries from older open tabs.
- Uses one dedicated connection and the existing global/order locks. The completion component uses the certified lifecycle assessor and protected service plan store, then the existing loyalty settlement component on the same transaction.
- Payment/audit/paid flag/completed state/plans/loyalty all roll back together. Already completed orders record payment details without re-completing, replanning or settling loyalty again.
- Unacknowledged proposed times and cancelled orders refuse combined completion. Existing payment captures are not overwritten. No notifications are queued for completion.
- Legacy outstanding orders can settle their existing pending loyalty amounts atomically through the same SQL calculation, instead of a second post-commit API request. Existing completion-only paths keep their original behavior.
- The normal Admin button/form reads “Take payment & complete”; completed orders use “Record payment”. Successful saves refresh the order list. Existing completion-only control remains compatible.

## Verification
342 regression tests passed. 22 real PostgreSQL transaction scenarios passed, including completion assessment refusal and payment-write failure after tentative completion, both with full rollback.
A synthetic Pad Thai/Prawn basket was completed through the deployed staging runtime: status completed, paid true, loyalty_settled true, exactly 10 points, one payment, one audit entry, one validated service plan, zero notifications. Identical retry changed none of those counts. This fixture exercised the imported-order/no-booking-receipt loyalty path as well. Synthetic records were then removed.
Only four runtime modules differ from the live payment release: payment writer, completion component, runtime wiring and loyalty helper. Nonchanged imported modules were checked against repository blob hashes.
Staging v61 binds digest 6f21aab0837b61af00af1ac0887c31a737d53cca37921f3079af5a9e4b1ba8a4. The first write test used an equivalent build before restoring exact whitespace in unchanged dependencies; v61 verified identical replay afterward. Full Admin Preview browser acceptance remains required.

## Release/rollback
No schema or Railway deployment is required. Deploy the new source-bound booking runtime first (old payment-only requests remain supported), then the Admin script. Rollback the Admin script to the payment-only UI first, then the prior runtime. Preserve all payment/audit, loyalty, order, booking and plan records. An already completed order cannot be reversed as a rollback side effect.

## Hosted Preview acceptance — PASS
At https://538fcc91.rungsthaikitchen.pages.dev/admin, the combined form saved a synthetic £10 card bill plus £2 cash tip. The refreshed row showed COMPLETED and both payment methods; reopening showed read-only saved details. PostgreSQL confirmed paid true, completed, loyalty settled, 10 points exactly once, one payment, one audit event and zero notifications. Evidence image: evidence/combined-payment-staging.jpg. Synthetic records removed. Known completion refusals return a definitive 409 so staff can close/review rather than being trapped in uncertain retry. Production remains on the original payment-only runtime pending approval.
