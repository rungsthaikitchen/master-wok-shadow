# Advisory availability performance — staging only

Hint scans now use a repeatable-read, read-only snapshot instead of joining the authoritative writer queue. A single query reads orders/items, service controls and the saved plan from the same snapshot. The connection is rolled back and released before routing and search. Atomic checkout, its locks, launch gate and full final assessment are unchanged. Hints cannot reserve or approve a booking.

Preserve an allowlist of read-only diagnostic reasons. DRIVER_UNAVAILABLE is a delivery conflict; SEARCH_LIMIT remains unverified. Arbitrary errors and checkout failures retain generic responses. The website uses up to 16 times per request with two workers, falling back to six-time batches after persistent transient worker failure. Future-day scans omit unused post-21:00 times; today's pre-cutoff overrun through 22:00 and approved links remain supported.

Hosted staging API measurements for the £104.50 basket on 21 November with two pre-existing delivery commitments:

- Collection: 27.283s before, 11.466s after; identical 46 available / 3 unverified normal-window slots.
- Public-landmark delivery: 26.457s with six-time batches after the initial SQL optimization, 9.362s with final snapshot and 16-time batches; identical 38 available / 11 disabled slots. Ten disabled slots carry DRIVER_BUSY; 17:00 remains unverified.
- Every measured batch returned HTTP 200. Timings exclude browser/Cloudflare gateway overhead and are measurements, not guarantees.
- 403 backend tests and 90 website tests passed. Snapshot SQL also checked against hosted staging data (two orders, two trips, normal service, no blackouts).
- No booking, order, service-control or notification writes were made by these measurements. Production remains LEGACY. No production certification is claimed.

The 17:00 opening-slot search remains unresolved; a separate offline four-minute-leg simulation exhausted search even with a higher budget. Do not relabel that uncertainty as fully booked or relax food-hold/resource limits.

## Basket line-order regression (17 November)

The customer's screenshot showed the same five lines in a different sequence. Replaying that sequence on staging v81 produced six unverified collection times: 18:20, 18:25, 18:30, 19:20, 19:25, 19:30. The previously used sequence produced only the last three. This reproduced a bounded-search traversal dependency, not a change in commitments (service plan still revision 6, two deliveries).

Canonical basket preparation now sorts scheduling lines by stable production phase and a deterministic full-variant key before classification. It retains separate duplicate lines, quantities, spice, modifiers and notes, without changing prices, policy or search budgets. All 120 permutations of this five-line basket produce identical raw scheduling input and classification; 405 backend tests pass.

Hosted v82 replay in the screenshot's sequence: 46 available, three unverified (19:20, 19:25, 19:30), 14.864 seconds, four HTTP 200 batches. The public-landmark delivery control still returns 38 available and the same 11 disabled times, in 12.003 seconds. Browser timings may differ. Production unchanged; the remaining search uncertainties are not claimed resolved.
