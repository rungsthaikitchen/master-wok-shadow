# Review approval investigation — 16 November 2026

Draft only; no production or staging booking-runtime deployment.

The failed Saturday approval checkout recorded `REVIEW_APPROVAL_MISMATCH`.
The historical diagnostic did not identify the differing field. It cannot now
prove whether basket, type, time, phone, address or holding acknowledgement
caused the rejection; this change must not be described as a confirmed fix for
that historical transaction.

A reproducible issue is corrected: the approval comparator previously rejected
the same UK contact in national and +44/0044 international formats. It now
recognises those forms, including the optional parenthesised trunk zero. Different
phone numbers still fail; basket, address, type, time, expiry, one-use consumption
and acknowledgement checks remain intact.

Mismatch errors now carry a fixed list of field names into the existing private
transaction log. The log filters the list against an explicit enum and records
no phone numbers, addresses, baskets, tokens or arbitrary exception values.
The public error code and rollback behaviour remain compatible.

Validation: `npm test` passes all 390 tests, including UK-format equivalence,
each individual mismatch field, rejection of changed numbers and an assertion
that only safe field names are logged and rejected transactions roll back.

Remaining: customer-facing recovery messages and a full browser approval-link
rehearsal. Do not reactivate Master Wok based on these unit tests alone.
