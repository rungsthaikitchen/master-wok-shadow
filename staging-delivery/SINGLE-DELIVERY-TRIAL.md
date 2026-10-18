# Single-delivery retrospective trial — prepared 18 October 2026

Local preparation only. Nothing committed, deployed or requested from Google.

The reviewed scenario is Saturday 17 October's earliest saved order: delivery, placed 16:38:48 BST, preferred arrival 17:00, saved proposed/confirmed arrival 17:15. The complete saved export contains six orders. No earlier saved order is present. The original timestamp/basket is private and is not included in this code package.

The model uses a clearly hypothetical empty prior plan only for the unique first saved order. It refuses earlier collections/cancelled orders, tied earliest placements, missing coverage, incomplete counts, missing directional estimates and unacknowledged proposed times. No unrecorded work or driver commitments are assumed; that assumption is explicit, not proof of actual availability. The saved confirmed time is assumed in force at placement solely for this conditional scenario; its actual agreement time is unknown.

Current travel estimates cannot be evidence of September/October historical traffic. The adapter keeps the actual capture timestamp separate and explicitly maps the durations onto a hypothetical historical clock for the offline model. It labels this CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY, never backdated route measurements or decision accuracy. Results are verified=false.

The real RTK kitchen and driver planners enforce two-minute loading and handover, arrival ±10 minutes inclusive, maximum food-ready-to-door 20 minutes with under 15 preferred, and the full return journey. Simulated sensitivity checks against the private basket accepted 5/8/12/18-minute outbound assumptions and rejected 21 minutes; these are not actual travel estimates or a validated delivery recommendation. The 18-minute assumption reached the 20-minute food-to-door limit. The return assumption was 12 minutes in those offline checks.

The one-shot runner is default-off and scoped to the exact project/environment and a dedicated master-wok-single-delivery-trial service. It requires independent enable/live-request flags, budget exactly 2 and scope ONE_CUSTOMER_TWO_ROUTES_MEMORY_ONLY. It checks the source/menu before any provider request and validates all points before quota use. The existing Google adapter makes two sequential Compute Routes requests (outbound and return), with no retries. Provider errors return UNVERIFIED without partial assessment. Logs omit locations, source aliases, baskets, travel durations, detailed recommendations and secrets.

Validation: 144 Node test entries passed in Europe/London and UTC, including nine new scenario/runner tests. Fake provider transports only; zero real requests. Actual CLI without flags returns DISABLED/networkRequests=0.

## Proposed approval scope

Commit only this code/test/document package to delivery-route-staging. Create one isolated staging service master-wok-single-delivery-trial, pinned to that commit, with Node 22, no volume/domain/cron/healthcheck and restart NEVER. First deploy disabled. Reuse the existing staging Google key by private service-variable reference without exposing it.

Perform a minimal read-only production lookup to rebind the earliest 17 October order and obtain its customer coordinates plus the restaurant routing origin from existing configuration. No names, phone numbers, emails or free-text addresses need be sent to Google. Do not put coordinates or the real basket in GitHub. Stage the reviewed snapshot/points as temporary private Railway input only for this execution.

After specific approval, enable one run: maximum TWO potentially billable Google Compute Routes requests, sending the restaurant and that one customer's coordinates in both directions. Routing is TRAFFIC_UNAWARE. This tests a present-day estimate against a retrospective hypothetical scenario; it does not reproduce Saturday's traffic or actual booking decision. No automatic retry or recurring route polling. Provider estimates and detailed derived plans remain in memory; only redacted aggregate status/reason is emitted. No production deploy, source writes or live booking changes.

After execution, disable both flags and remove the temporary private input (including customer coordinates and basket). Leave the service disabled. If the origin or selected candidate cannot be bound confidently, make zero provider requests and report the missing input. Customer-coordinate disclosure to Google and temporary Railway private-input storage are part of the approval scope, not implied by prior public-landmark tests.

No numeric real-route plan will be retained under this initial scope. A useful later live-shadow phase will need an explicitly approved retention policy and a dated complete commitment manifest for each assessment. The existing private evidence collectors remain untouched.
