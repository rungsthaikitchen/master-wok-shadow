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
