# Historical payment completion — 13 November 2026

RTK-1596 (legacy service 31 October, customer_accepted_time, loyalty already settled) could not record £51.50 card payment because combined completion attempted to certify a past service with the current scheduler. The failed transaction left no payment.

The correction permits bookkeeping completion only for explicitly LEGACY orders whose commitment/proposed dates are all before the database clock's local service date, with no Master Wok booking receipt and no stored service plan for any affected date. Loyalty must already be settled. The original scheduler identity is retained and no plan or loyalty balance is changed. Current/future services and Master Wok-owned services retain certified completion. Historical unsettled loyalty is refused for review.

Payment, completion, paid flags and audit remain one transaction. Idempotent replay returns the original capture. Late insertion failure rolls completion back.

Validation: 358 core tests and 37 real PostgreSQL staging scenarios passed. Deployed staging Edge67 with source 1da6e067f479d3fd9f9cccb7d0519e039fb2e2f982a817357402d16e552543f5. The deployed authenticated payments endpoint captured a synthetic historical £51.50 card/no-tip fixture and completed it; an identical retry replayed. Database verification found one payment and one audit event, LEGACY retained, loyalty settled. No notifications were sent. No production customer payment was captured by verification.

Production scope: corrective repair to the owner-approved actual-payment release following the reported RTK-1596 failure. No frontend, database schema, release mode or Railway change. Production artifact is built with --release-historical-payments and the historical-payments production certificate. Rollback restores the previous Edge13 bundle (source dc4f1ea892e37f1815055808be8ca48cb51b01ee1cb74c2199be7d856e449e6a); retain any legitimate payment/audit already recorded. The customer order is left unchanged for the owner to retry in Admin.
