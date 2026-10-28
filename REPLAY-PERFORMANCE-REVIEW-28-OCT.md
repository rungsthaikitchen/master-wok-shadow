# Offline comparison review — 28 October 2026

The hosted browser trial remains disabled. This change introduces only an offline,
default-disabled aggregate report; it changes no scheduling, reservation, database,
website or notification behaviour. No Railway deployment is needed.

## What the report measures

`master-wok-replay-report.js` runs the existing chronological validator/replay and
aggregates its observations. It compares recorded ACCEPTED / DECLINED / SUGGESTED
decisions against hypothetical GREEN / AMBER / UNVERIFIED recommendations. It
does not substitute the model recommendation for the recorded reservation change.
Order/event aliases, baskets, individual timestamps and assessment payloads are
excluded from the aggregate output. The input still needs an anonymised export.

UNVERIFIED rows remain visible and are excluded from assessed-decision counts.
No accuracy percentage is calculated. Coverage completeness is an input claim,
not independently proven by an offline report. Cutover baseline commitments are
shown separately and do not become historical decision observations.

| Comparison | Evidence required | Current report treatment |
| --- | --- | --- |
| Master Wok vs recorded booking choice | Complete ordered decision/reservation events and then-known food-ready estimates | Decision/recommendation count matrix |
| Master Wok vs existing engine | Existing engine's original recommendation captured at the same decision, plus build/policy identity | NOT_CAPTURED; staff acceptance is not a substitute |
| Master Wok vs actual kitchen activity | Actual start/ready observations with timestamp precision and order linkage | NOT_CAPTURED; hypothetical plans are not kitchen activity |
| Delivery plan vs actual journey | Actual departure, drop and return observations; directional route estimate provenance | NOT_CAPTURED; accepted arrival targets are not actual arrival evidence |

## Regression and synthetic example

Validation: the complete root Node suite passed 196 tests in Europe/London and
196 tests in UTC, including five new report tests. No hosted test was performed.

The anonymised synthetic fixture contains five booking decisions. With the real
engine in Europe/London, four are assessable and one remains UNVERIFIED because a
delivery-ready estimate is missing. Two decisions see an existing proposal. The
matrix is ACCEPTED: two GREEN / one UNVERIFIED; DECLINED: one GREEN; SUGGESTED:
one GREEN. This demonstrates reporting, not restaurant performance. A GREEN result
on a recorded decline is a review candidate, not proof the decline was wrong.

UTC preserves the existing engine's SERVICE_TIMEZONE_REQUIRED guard: four kitchen
assessments become UNVERIFIED rather than silently using the wrong service clock.
Use the explicit UK timezone when generating a usable real-engine report:

```bash
TZ=Europe/London MASTER_WOK_REPLAY_REPORT_ENABLED=true node master-wok-replay-report.js < fixtures/chronological-synthetic-service.json
```

The report is disabled without the flag. Invalid/incomplete logs fail as a whole
without partial counts. CLI input is capped at 5 MB. No network client is added.

Existing chronological regressions confirm immediate proposal replacement,
acceptance without a second reservation, rejection release, stale-response refusal,
and assessment against only then-known commitments. Existing September regressions
preserve corrections and approximate/lower-bound evidence without inventing route
or kitchen timings.

## 18 September and next evidence collection

The September saved-state export is suitable for conditional retrospective
scenarios, not exact chronological accuracy claims. The owner-reported corrected
fulfilment methods, after-21:00 lower-bound agreement, approximately-21:30 arrival,
and reported combined drop order remain recollections with their existing precision.
The regression demonstrates that a later saved reschedule can mask earlier risk;
it cannot establish when every historical change was offered or accepted.

For a service review, first establish event sequence/coverage and count missing
estimates. Then review ACCEPTED/AMBER, DECLINED/GREEN and SUGGESTED rows with
context. Separately attach owner-reported service pressure and timestamped actual
outcomes, preserving their precision. Do not infer per-order success from a
comfortable overall service. Compare engine recommendations only once original
existing-engine recommendations are captured; keep that integration read-only.

Outstanding hosted dependency remains successful private diagnostic deployment,
read-only journal inspection, then a separately bounded browser trial. This report
does not close that dependency or change production capture permissions.
