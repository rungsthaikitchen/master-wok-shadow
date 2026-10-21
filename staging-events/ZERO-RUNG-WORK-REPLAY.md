# Zero Rung workload in server replay

21 October 2026. Offline review change only; no deployment, database writes or changes to live availability/checkout.

The authenticated cross-date lifecycle fixture used jasmine rice. Its recorded recommendations were UNVERIFIED because both the calibrated and raw Rung durations were zero, whereas the generic scheduler requires a positive cooking duration. That was an assessment limitation, not missing transfer history.

The server adapter now explicitly opts into allowZeroRungWork for historical replay. Only a classification whose rawMinutes and reservedMinutes are both numeric zero is omitted from the Rung scheduler input. Booking/event commitments remain present, acceptance still confirms the same reservation, and cancellation/completion still release it. No fictional one-minute job, kitchen start or completed cooking activity is created.

The underlying scheduler's positive-duration contract is unchanged. The new replay option defaults false, including for truthy strings, so existing direct callers retain their behaviour. Positive-work baskets use the existing schedule. Empty, unknown or malformed menu input remains unverified at the server boundary. A zero-work target before assessment time remains unverified, as do failed prior plans. Deliveries still need separate food-ready/travel evidence; a zero Rung workload does not establish delivery feasibility or Sam's capacity.

The original authenticated fixture is retained unchanged. Reassessment under the new adapter produces three GREEN hypothetical Rung-capacity observations in London, with one remaining provisional commitment on 21 October and none on 22 October. This does not rewrite the original Railway journal, which remains pinned to the preceding build and its recorded UNVERIFIED results. Old pending work remains subject to the existing build-identity checks.

Regression coverage includes explicit opt-in/default preservation, no manufactured jobs, rice/Sam-only and mixed baskets, prior cooking load, failed prior schedules, expired targets, unknown/empty menus, incomplete history, missing duration fields, delivery uncertainty and the original authenticated transfer export. All outputs retain verified=false and hypothetical evidence labels.

Deployment: no action taken. Keep the staging service pinned and disabled while the paired acquisition/freshness controller and independent recovery coverage are prepared. Those and complete writer/baseline coverage remain requirements before production event capture.

Validation: 187 core Node tests and 19 focused staging tests pass in each of Europe/London and UTC. All 68 Python event tests pass, including real process termination before acknowledgement and reopened-snapshot integrity. No cloud or production operations were performed for this fix.
