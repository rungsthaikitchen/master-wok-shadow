# Hosted checkout and approval verification — 16 November 2026

Combined draft runtime PRs 15 and 16 were deployed only to staging project
`hvrqgufqjslvgiohgkvu`, function `master-wok-booking` version 77, source digest
`05fc96ca7e7e2ead6e0c216eb19316a2e64dec99de709142a12d57f3cb8561de`.
Certificate remains CANDIDATE_FOR_STAGING, not production certification.
The protected website preview points to the existing staging Railway gateway.

## Passed

- Actual approval create/approve/lookup/checkout/consume flow with £48 basket,
  including split identical curry lines and equivalent international phone.
- Missing holding acknowledgement refused; same-key retry returned the same
  order without another receipt; consumed link refused further lookup.
- Browser £29 food basket: 49 normal collection times and 49 delivery times;
  delivery retained with 49 verified times after closing/reopening checkout.
- Browser delivery checkout: £29 food plus £2 delivery, staging RTK-210.
- Browser approval checkout: £48 delivery, staging RTK-211.
- Full staging-runtime £104.50 availability scan: nine requests, 49 times,
  46 available and three unverified, no HTTP failures. This is not evidence that
  the three remaining times are physically impossible.
- Combined runtime tests: 393 passed.

## Browser-discovered fixes

Website PR 91 corrects two additional issues:

1. A consumed approval remained in the page and poisoned the next basket's
   availability; clearing happens only after a verified successful/replayed
   receipt, retaining safe retry state on rejected/unknown outcomes.
2. Restoring an address did not trigger the blur-based geocoder in a fresh
   session; approval restore now awaits the existing address/pricing check.

Recheck at website commit 9599503 created staging RTK-212 at 20:30 on 20 November,
with automatic address verification, free delivery, £48 total and one consumed
approval. The next collection basket had no old checkbox and all 49 normal
times. All 89 website Node tests pass. Credential-free screenshots and browser
evidence are committed in website PR 91 under `tests/evidence/`.

## State and cleanup

Only synthetic @example.invalid identities and reserved test phone numbers were
used. Address tests used the public Morley Town Hall landmark. Staging
notification credentials were isolated from existing workers; their old secret
was verified HTTP401. No notification deliveries were created.

Synthetic orders RTK-209 through RTK-212 were cancelled through the lifecycle
API after verification. Receipts, consumed grants and audit records remain.
Their eight pending notification events were explicitly skipped. There were
four cancelled fixtures and zero notification deliveries at cleanup readback.

Staging v77 remains available for preview testing, with notification credentials
isolated; do not enable providers against this candidate. Production launch
control remains LEGACY revision 10. No production deployment or writes.

Remaining: user preview test, the three unverified heavy-basket times,
RTK-1641's historical delivery/time rejection, staff order entry and rollback
independence. Do not call the whole scheduler fixed or reactivate from these
checks alone.
