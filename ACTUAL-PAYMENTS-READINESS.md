# Actual payment amounts — 13 November 2026

Status: private staging only. Production unchanged; owner approval pending.

The payment form defaults to the bill due but accepts the actual amount received towards it. Any difference requires a reason and the displayed order-total version. Tips are independently entered and never offset a bill underpayment. An overpayment remains an overpayment, not an invented tip or discount. No order prices, discount codes or loyalty formula are changed by payment capture.

The existing atomic payment/completion transaction now records actual receipts, order-total snapshot, difference reason and balance in its audit event. Underpayments set paid=false/payment_status=underpaid while still completing an explicitly completed order; overpayments set paid=true/payment_status=overpaid. Idempotent retries retain the exact amount/reason/key and replay before stale-total checks. Older equal-total requests retain their original fingerprint and behavior. Payment list/read responses report the current difference.

The Admin row/payment details show actual receipt and bill balance. End-of-day totals sum actual receipts and separate tips; exceptions identify the amount underpaid/overpaid rather than repeating the full payment amount. No new database schema or Railway change is needed.

Validation: 355 core tests, 67 website/access/receipt tests and 32 real PostgreSQL staging scenarios pass. Includes 30p underpayment with a separate cash tip, overpayment with zero tip, invalid/missing reason, stale totals, concurrent/duplicate captures, atomic completion/rollback and replay after a later order-total change. Hosted form/receipt acceptance is pending.

First release still captures one bill receipt per order. Additional instalments, refunds and corrections to an existing capture need their own audited adjustment path; do not create duplicate captures. Completed-order amendments remain a separate work item, with kitchen/driver history preserved. The synthetic RTK-PAYMENT-PREVIEW fixture is reserved for hosted acceptance.

Release after owner acceptance: check production runtime/source drift, certify this exact source, deploy --release-actual-payments with the existing release binding and secrets, then merge the website change. Verify live read/preview without changing customer orders. Rollback restores previous Edge source and frontend scripts; retain actual receipts and audit events already captured. The prior schema can store these amounts unchanged.
