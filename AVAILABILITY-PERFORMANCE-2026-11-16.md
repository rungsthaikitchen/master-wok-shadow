# Availability performance investigation — 16 November 2026

Status: draft; no production deployment or launch-control changes.

Saturday's production logs recorded CPU-limit failures during availability and
Admin operations. They do not establish that the kitchen was full. Separately,
the owner deliberately applied fully-booked periods for an early finish, service
protection, and a final closure. Those restrictions must not be counted as faults.

## Change

Profiling a reconstructed 14 November service snapshot plus the reported £104.50
basket showed substantial CPU use and garbage collection in the nested fryer
search. The implementation now:

- indexes occupied fryer minutes, preserving exclusive end boundaries;
- builds full attribution only for the successful branch;
- reuses fryer assessments when attributed frying deadlines are identical during
  one coordinated assessment and one holding-policy attempt. Wok vessel choice
  alone does not change those deadlines. No cache crosses transactions, service
  snapshots, or the preferred/maximum holding-policy boundary.

Search limits, holding limits, arrival deadlines, physical capacities, validation,
and booking write authority are unchanged. Attempts to reduce search budgets or
add expensive symmetry bookkeeping were discarded.

## Validation

- `npm test`: 390 passed, zero failed, after rebasing onto the latest staff-time
  confirmation release (0ebfec4).
- 150 deterministic comparisons against the original fryer implementation gave
  identical complete outputs, including attribution and search-node counts.
- Reconstructed £104.50 collection-basket scan against saved Saturday work:
  all 61 status/reason pairs unchanged, 47 verified. Local elapsed time:
  3147 ms before, 1134 ms after. Process CPU: 3684 ms before, 1633 ms after.
- The £29 small-basket reconstructed scan verified 56 of 61 times locally.
- New regressions cover fractional blackout overlap, exclusive boundaries,
  changed frying deadlines, and cache isolation between assessments.

The reconstruction uses the last saved plan and restored matching commitments,
including restoring RTK-1641's then-recorded collection type. It is not an exact
historical snapshot of every attempted checkout. Route durations come only from
stored plan legs; no customer address/coordinates were sent to routing services.
Private source snapshots and benchmark scripts are not committed.

These local measurements are not evidence that hosted CPU failures are resolved.
Hosted rehearsal under the Edge runtime limit remains required. In particular,
the heavier-basket scan still has unverified results; it is not a complete
availability fix. Approval-link mismatch, delivery amendment diagnostics, staff
order entry and rollback independence remain separate work.
