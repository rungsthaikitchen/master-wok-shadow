# Basket review candidate — 7 November 2026

Status: local implementation plus isolated staging storage checks. Not approved
for production. Legacy remains authoritative. The four-ring scheduler is a
separate unfinished launch dependency; this enquiry feature does not fix it.

## Implemented

- Unavailable-slot dialog offers an optional name/phone/preferred date/time form
  only when the review feature is enabled. The existing basket is retained.
- Server validates and prices the basket, preserving modifiers, spice and notes.
  Delivery enquiries retain an address. No orders, reservations, loyalty changes
  or notifications are created.
- Browser retries keep a stable request key across refreshes in the same tab.
  Session storage contains a hash/key only. Changed details after an uncertain
  reply are blocked. Database upsert compares the complete stored request.
- Existing Admin receives a review section with basket, contact, requested time,
  total, server assessment explanation and contacted/resolved/closed actions.
  Status changes compare the expected prior state. They cannot accept a booking.
- Admin uses the official pinned Cloudflare Access Pages plugin, application
  audience and explicit email allowlist. A separate private upstream credential
  prevents public checkout proxies from obtaining customer review records.
- Diagnostic assessment uses a rollback-only capacity transaction. A model fit
  does not reserve time. Search limits/unrecognised failures remain unverified,
  rather than being presented as a proven physical kitchen bottleneck.

## Staging evidence

The table was created only in `master_wok_rehearsal` in Supabase project
`hvrqgufqjslvgiohgkvu`. No production database change was made.

`node staging-tests/build-review-storage-check.cjs` emits a rollback-only SQL
check using the real store's SQL and all four customer-supplied £150 examples.
Executed on staging: PASS for stored values, four unique requests, identical
replay, changed replay conflict, RLS, and no anon/authenticated table read.
Follow-up query confirmed zero synthetic reviews remained. This was not a
concurrent connection test.

Core suite: 272 passed. Website suite: 35 passed. Backend route suite: 19 passed.
The browser test `tests/basket-review-browser.cjs` was added but could not run:
installed Chromium aborts on socket/process creation in this workspace. No
browser result or hosted end-to-end result is claimed.

## Configuration before hosted staging

Pages Preview only:

- `MASTER_WOK_BASKET_REVIEWS=enabled`
- `RTK_ORDER_BACKEND_URL` points to the isolated staging backend
- Existing `RTK_PROXY_SECRET`
- `MASTER_WOK_REVIEW_ACCESS_DOMAIN` exact HTTPS Cloudflare Access team domain
- `MASTER_WOK_REVIEW_ACCESS_AUD` application audience protecting review Admin
- `MASTER_WOK_REVIEW_ADMIN_EMAILS` explicit comma-separated staff email allowlist
- `MASTER_WOK_REVIEW_ADMIN_SECRET` random secret of at least 32 characters

Staging backend only:

- `MASTER_WOK_BASKET_REVIEWS=enabled`
- Matching `MASTER_WOK_REVIEW_ADMIN_SECRET`
- Existing proxy secret and staging booking transport configuration
- Keep `MASTER_WOK_BOOKING_MODE=LEGACY`

Protect `/admin-api/basket-reviews` with the relevant Access application. Reuse
an existing suitable staff application where possible. Never use a general
customer authentication audience. The values are not available in this checkout.

The changed core source invalidates the previous release digest. Rebuild a
staging candidate and its server bundle; do not reuse the old certificate or
change it to production-ready merely to deploy this feature.

## Remaining gates

1. Supply/verify staging Access configuration and deploy candidate transport.
2. Browser test at mobile and desktop sizes; keyboard focus/close behaviour.
3. Hosted enquiry from unavailable checkout to authenticated Admin, including
   lost reply retry, changed basket, status conflict and a delivery address.
4. Concurrent identical submissions on separate connections.
5. Confirm no orders/capacity/loyalty/outbox changes and no production requests.
6. Inspect pressure explanations against known £50/£100/£150 baskets. The current
   assessment model is not yet the approved four-ring production model.
7. Production approval for a concrete deployment after these gates pass.

## Feature rollback

Disable `MASTER_WOK_BASKET_REVIEWS` in Pages and backend and redeploy the changed
configuration. The customer keeps the telephone fallback. No confirmed bookings
are unwound. Stored enquiries remain private for staff follow-up. This sequence
still requires a hosted rehearsal; it is not a tested production rollback.

## Backend deployment checkpoint

Owner-approved backend candidate `2042d266bf7c81058428ff996205d2380f4694ec`
was deployed to the existing Railway staging gateway on 7 November 2026.
Deployment `f17c83d0-6d0e-49d2-89f9-afe7b58ad483` reached SUCCESS. Hosted smoke
checks passed for health, LEGACY mode, disabled basket reviews and unauthorized
Admin review requests. Reviews remain disabled. No orders or reviews were
submitted. Core writer/Preview integration and browser certification remain open.

## Hosted writer checkpoint — 7 November 2026

The existing staging `master-wok-booking` Edge Function was rebuilt with the
current source digest `94ea4d4b3116891d14e4959eff3ce0a9009a4af76b75de987a675176158600de`.
The candidate remains `CANDIDATE_FOR_STAGING`; all its certification checks were
reset to PENDING. Durable launch state remains LEGACY, revision 38, with no
approved release ID. No production function or database was changed.

An initial private configuration had an old release ID. It was corrected against
the candidate before the successful hosted checks. The final deployed function
is version 45. It authenticates its own requests. A distinct private notification
secret prevents existing workers from using this enquiry rehearsal runtime.

`python staging-tests/check-review-hosted.py` passed against hosted HTTP and the
staging database for all four supplied £150 baskets. Two simultaneous identical
requests per basket produced one review ID each. Changed request details were
rejected with 409. Staff listing retained all four £150 values and ignored fake
client diagnostics. A stale expected Admin status returned 409. All four synthetic
reviews were closed after testing; none remain active.

Before/after database totals were identical: orders 60, service plans 6,
notification outbox events 81, loyalty points 177. No booking was submitted by
the test. This checks the writer API and PostgreSQL, not the browser or full
website/gateway path. Backend basket reviews remain disabled pending connection.

The website candidate is draft PR 68:
https://github.com/rungsthaikitchen/Rungs-Thai-Kitchen/pull/68
Commit: f5a6edfee485a3b2c05b6ae170b2c63aa5124dcb.
Remote baseline hashes were checked before publishing the isolated branch.
35 website tests pass and Wrangler 4.158.0 compiles the complete Functions worker
successfully using compatibility date 2026-11-07. Cloudflare Preview nevertheless
reports a failed build (deployment 31f62f67-014c-433d-ad1a-af7ea53358fd). Its build
log requires account authentication; no cause has been established or speculative
fix applied. First build error is needed to continue. Staff Access configuration,
Preview/gateway connection, browser walkthrough and production release remain open.

## Preview dependency fix — 7 November 2026

Owner-supplied Cloudflare logs identified the failure exactly: no build command
or dependency-install step ran, and Wrangler 3.114.17 could not resolve the npm
Access plugin. The earlier local build had an installed dependency and did not
reproduce that pipeline.

Preview commit `69305be99588692ad1fe7bfaaa05d4dc0f8e2cdb` vendors the official
pinned Cloudflare Access plugin 1.0.5 and its API helper with MIT license and
provenance. Only the self-import and missing source-map references were changed.
The review route now uses a relative import, so it needs no npm install in
Pages. Authentication was not marked external, bypassed or removed. Production
build settings were not changed.

Validation: all 35 website tests pass. A clean directory containing only
Functions and the vendored dependency, with no application node_modules,
compiles successfully using the exact hosted Wrangler 3.114.17 version.
Three staff Access-boundary tests also pass from that clean directory.
Cloudflare hosted build verification is recorded separately once completed.

Cloudflare verification: commit `69305be99588692ad1fe7bfaaa05d4dc0f8e2cdb`
completed successfully. Preview deployment `e2b0f8bb-6ebb-444b-83a0-8dae431292a6`
is https://e2b0f8bb.rungsthaikitchen.pages.dev . The GitHub Cloudflare Pages check
reported "Deploy successful!". This resolves the dependency build blocker only;
review feature configuration, staff access and full browser flow remain pending.

## Connection configuration checkpoint — 7 November 2026

Cloudflare dashboard login was attempted through secure browser authentication.
Apple accepted the supplied account, but Cloudflare returned "Apple sign-on did
not work. Try again or contact support." A fresh dashboard tab also remained
signed out. No repeated sign-in attempt, bypass, Pages-setting change or Access
policy change was made. No Cloudflare plugin was found in the available catalog.

Prepared, NOT applied: Railway staging patch
`30f0b300-ff2e-40ce-9b2c-9864ec84fd56`, with two changes on the existing staging
gateway only: enable basket reviews and align its booking transport secret with
the deployed private staging writer. Booking mode remains LEGACY. No other
service or shared variables are staged. Applying requires explicit deployment
approval after reviewing that this patch has not changed.

Cloudflare Preview configuration remains the blocker. Obtain current Preview
variable names (not secret values), verify the explicit staging backend/proxy
configuration, then add the review feature flag, existing private Admin upstream
credential, staff Access domain/audience and staff email allowlist. Do not edit
Production variables or weaken the Access policy. Full browser/gateway enquiry
certification is still pending.

## Approved connection and real browser walkthrough — 7 November 2026

Owner approved applying Railway staging patch
`30f0b300-ff2e-40ce-9b2c-9864ec84fd56` and redeploying Preview. The patch was
re-read and matched before application. Backend deployment
`c764bb97-3b92-467b-b600-d1f30d4f62fc` reached SUCCESS. Preview redeploy commit
`1bc66607b5079dfc807597cb9b3e42a87050c5bb` also succeeded. No production
configuration, service or database was changed.

Cloudflare Access email-code authentication succeeded in the test browser.
The protected Admin review list successfully loaded through Pages, the Railway
proxy and the staging writer. The enquiry-only gateway remains in LEGACY mode.

The walkthrough found that the correct Preview LEGACY checkout guard prevented
customers reaching the original no-slot-only dialog. Commit
`d0577a4a67b4f27b02763c2d3ec705f5db05c5b9` adds a separately gated enquiry button
when online time checks fail. That path says "Online times could not be checked"
rather than claiming the basket cannot fit. It does not enable booking authority.
35 website tests pass. Cloudflare deployed the change successfully as
`a4a4b04e-edce-4989-a9bf-b38637eff6d7`.

Actual deployed browser test, using the stable Preview branch URL:

- Built three portions of Pork Steamed Dumplings (£18), opened checkout and
  selected collection on 13 November 2026.
- Used the enquiry button while Preview booking remained blocked.
- Confirmed contact/date fields were prefilled and selected 20:15.
- Sent a synthetic enquiry and observed the explicit unconfirmed-order receipt.
- Refreshed protected Admin and saw exactly three dumpling portions, £18,
  collection and requested 13/11/2026 20:15.
- Marked contacted in Admin, verified the status, then closed the synthetic
  review and observed no active reviews.
- Returned from the customer dialog to checkout and confirmed the three-portion
  basket and £18 total were retained during that interaction. A page reload was
  observed to clear the existing basket; persistence across reload is NOT claimed.

Staging review ID: `975041b9-df6f-4c70-89fa-c622a79d0638`, status closed.
The stored diagnostic is UNVERIFIED; no confirmed cooking bottleneck was found
for this request. The Admin renders that uncertainty explicitly.

Database totals before and after remained orders 60, service plans 6, outbox 81,
loyalty points 177; durable launch mode remained LEGACY. No booking was submitted.
Internal browser screenshots were retained under the shared test-evidence folder.

This is a passing desktop collection-enquiry integration test, not scheduler
launch certification. Mobile layout/focus, delivery enquiry, model-fit/no-slot
path, improved bottleneck diagnoses and feature rollback rehearsal remain open.
The four-ring/20-minute-holding scheduling integration still needs completion
and its own full launch validation. Production launch is not approved.

## 7 November: protected batches and four-ring blackout corrections

Corrected protected-plan validation to use confirmed batch-specific microwave
durations: two dumpling portions take six minutes, three take eight. Previously
the planner produced these batches but saved-plan validation expected four
minutes, preventing later lifecycle/replanning operations. Regression tests now
preserve started batches through a new booking and cancellation and reject
incorrect saved durations.

Corrected the staging four-ring entry point to forward kitchen blackouts to
the shared-ring allocator. The allocator now checks all work, including cold
preparation, against those intervals and rejects malformed blackout data.
Tests cover blocked work, moving work before a blackout, exact boundary timing,
and propagation through the cross-order entry point.

Core suite: 275 tests passed; git diff whitespace check passed. These are local
source changes, not deployed runtime evidence. Hosted staging version 45 and
its recorded source digest predate these corrections; do not certify the new
source using that deployment's evidence. Production remains unchanged.

Remaining integration risks confirmed during inspection: coordinated planning
still uses the single-wok path; the shared-ring path does not coordinate fryer
or microwave prerequisites; protected plans and independent timeline validation
still assume a single wok. The coordinated 20-minute retry currently extends
curry holding only, not the approved policy across all food types. These paths
must be joined and independently validated before four-ring booking authority.

## 7 November: joined holding-policy correction

The coordinated single-wok pipeline now tries the preferred ten-minute hold
first and then twenty minutes across main dishes, auxiliary work and standalone
fried dishes. This supersedes the curry-only retry limitation noted above.
The selected policy is recorded as `holdingLimitMinutes` in the plan and passed
to protected-plan auxiliary validation and the independent combined assessment.
Intermediate fryer prerequisites retain their stricter ten-minute gap before
the main cooking step; extending finished-dish holding does not relax that gap.
Existing curry-named policy fields are retained for compatibility.

Regression evidence includes four noodle portions requiring an eleven-minute
hold; nine dumpling portions using three eight-minute runs with a maximum
sixteen-minute hold; twelve dumpling portions remaining unverified; preferred
ten-minute plans for smaller baskets; protected-plan replay and full combined
assessment for the larger microwave basket; and standalone frying at exactly
twenty minutes while intermediate prerequisites still fail outside ten minutes.
All these results retain `bookingApprovalAllowed=false`.

These changes remain local and require a new staging build and source digest.
Four-ring coordination and lifecycle integration, hosted end-to-end validation,
delivery/mobile review checks and rollback rehearsal remain outstanding.

## 7 November: four-ring coordinated staging path

The existing coordinated planner now supports explicit `sharedRings:true` for
staging. Shared-ring search calls the existing fryer and auxiliary allocators
at each complete hob placement and backtracks when prerequisites cannot fit.
Complete-plan checks are bounded at 128, in addition to the existing search
node bound. Exhaustion remains SEARCH_LIMIT, never proof of impossibility.
The default single-wok path is retained.

Independent timeline validation checks vessel eligibility, four-ring capacity,
vessel reset, main durations and holds, exact main portion coverage, auxiliary
coverage, recipe-specific fryer coverage/durations/basket capacities, exact
fryer-to-main batch dependencies, placement boundaries and supplied blackouts.
Hob and fryer resource names are separated. Auxiliary small-wok work still
conservatively excludes all simultaneous main work. Per-vessel batch capacities
and chef concurrency remain unverified; this is not launch certification.

Verified joined staging results at 20:15 with orders placed at 15:00:

| Basket | Result | Selected hold maximum |
| --- | --- | --- |
| Original customer £50 basket | Independently checked joined timeline | 10 minutes |
| Original basket doubled, £100 | Independently checked joined timeline | 10 minutes |
| Original basket tripled, £150 | Independently checked joined timeline | 10 minutes |
| Customer mixed £150 | Independently checked joined timeline | 20 minutes |
| Customer starters/curries £150 | Independently checked joined timeline | 20 minutes |
| Customer stir-fry £150 | Independently checked joined timeline | 20 minutes |
| Customer noodles £150 | UNVERIFIED / SEARCH_LIMIT | None |

All 284 core tests pass and diff whitespace checks pass. Negative tests remove
microwave/fryer work, supply an unsuitable vessel, exceed ring capacity or add
a blackout. All results retain bookingApprovalAllowed=false.

The protected-plan path explicitly rejects sharedRings:true with
SHARED_RING_PROTECTED_PLANS_NOT_CERTIFIED. Parallel saved-plan lifecycle work,
concurrency/whole-service validation and hosted release checks must be completed
before that guard can be removed. No deployed code, production checkout,
production database or launch control was changed in this step.

## 7 November: parallel saved-plan lifecycle and corrected pan portions

Explicit staging-only protected planning now accepts both `sharedRings:true`
and `stagingSharedRings:true`. The regular booking path still rejects the
four-ring option without that staging flag. Saved plans have the distinct
model version `combined-kitchen-four-ring-staging-v1`; switching either way
between single-wok and parallel saved plans is rejected pending a drain.

The existing started-work dependency closure is reused. Fixed main jobs reserve
their actual vessel and shared-ring capacity rather than blocking every ring.
Started frying and microwave preheats continue to freeze their downstream main
jobs; cancelled started work remains occupied. Future microwave and fryer work
is checked against protected reservations. The recombined saved resource map is
validated again before returning a plan. No chef confirmations were added.

**Correction to the preceding basket evidence:** the shared-ring batch builder
previously allowed multiple curry portions in one pan job. David's confirmed
rule is four pan portions when all four rings are free. Curry, soup and coconut
rice work now uses one pan per portion. Independent and saved-plan validation
reject multi-portion pan jobs. This supersedes the earlier table where needed:

| Basket | Current joined staging result | Hold maximum |
| --- | --- | --- |
| Original £50 | Checked timeline | 10 minutes |
| Original doubled, £100 | Checked timeline | 10 minutes |
| Original tripled, £150 | Checked timeline | 20 minutes |
| Mixed £150 | Checked timeline and lifecycle | 20 minutes |
| Starters/curries £150 | Checked timeline and lifecycle | 20 minutes |
| Stir-fry £150 | UNVERIFIED / SEARCH_LIMIT | None |
| Noodles £150 | UNVERIFIED / SEARCH_LIMIT | None |

SEARCH_LIMIT is unknown feasibility, not proof that a basket cannot fit.
293 core tests pass; whitespace checks pass. New lifecycle tests cover free-ring
use during started cooking, four occupied rings rejecting a fifth simultaneous
cook, later orders, cancellations, changed times, dependency preservation,
corrupt saved vessels/overload, protected microwave overlaps, and both model
transition directions. Large-basket lifecycle tests cover the two currently
verified customer £150 examples. All returned booking authority remains false.

Still local and undeployed: a new staging source build/digest, atomic concurrent
booking integration, whole-service rehearsal, rollback, and remaining hosted
customer/Admin checks are needed. Small/large-wok portion capacities and chef
concurrency remain explicit model-validation gaps. Production remains Legacy.

## 8 November: real PostgreSQL checkout contention rehearsal

Added `staging-tests/four-ring-atomic-edge.js`, bundling the existing atomic
checkout, transaction writer, commercial calculator, order store, plan store,
commitment reader and explicit staging four-ring assessment. The test accepts
no request-supplied baskets; it generates fixed collection fixtures on
2099-11-11 in master_wok_rehearsal, authenticates with a temporary random key,
and never changes launch controls or sends notifications.

The first hosted run returned HTTP 546 before completion. Inspection found one
synthetic order and its saved four-ring plan, after the test had progressed to
the distinct-key race. This is NOT a passing hosted concurrency certificate.
The costly rejected-candidate search required an early necessary-workload bound.
The allocator now rejects fixed batches whose cooking minutes exceed the full
four-ring window or the two-large-wok window before searching placements.
This also diagnoses the noodle-heavy example as exceeding the current fixed
batch partition's large-wok window; it does not rule out other batch policies.

294 core tests pass after that correction. Hosted retest remains pending.
The probe was replaced with a disabled HTTP-410 version (version 2) so it cannot
rerun or write while cleanup is pending. The deployed booking function is
unchanged. SQL cleanup confirmation expired; no cleanup success is claimed.
Remaining synthetic fixture prefix:
`four-ring-race-3b0c247a-9b72-4291-9dff-1200e3821ac3-`.
Cleanup must remove only that prefix's staging event, receipt and order, plus
its 2099-11-11 saved plan after verifying no other orders occupy that date.
Then rebuild the probe with the workload bound, rerun, verify zero remnants,
and disable the probe again. Production remains Legacy and untouched.

## 8 November: hosted four-ring atomic rerun passed

User performed the approved isolated cleanup in the staging SQL Editor; a
read-only query confirmed zero fixture orders and plans before rerunning.
Rebuilt the probe with the early workload bound and deployed probe version 3.
The real PostgreSQL rehearsal returned PASS for:

- Concurrent identical requests: one persisted order and plan, same returned ID.
- Changed payload with the same retry key: rejected as an idempotency conflict.
- Distinct concurrent orders competing for four-ring capacity: one committed,
  one unverified, with capacity reassessed under the existing transaction lock.
- Injected plan-save failure: order header, items, receipt and notification
  event rolled back together, leaving no partial order.

Independent post-run SQL verified zero four-ring test orders, receipts or plans;
staging totals returned to 60 orders and 81 outbox events. Probe version 4 is a
disabled HTTP-410 handler. Evidence: STAGING-FOUR-RING-ATOMIC-RESULT.json.
No production writes, notifications sent, or launch-control changes occurred.

This is a completed fixed-fixture collection concurrency/transaction-rollback
gate, not full release certification. Whole-service and customer/Admin hosted
validation, delivery coverage, model gaps and deployment rollback still remain.

## 8 November: seven-order hosted collection-service rehearsal passed

Extended the same private probe with the existing lifecycle writer and mutation
assessor. The assessor's four-ring option is explicit server bootstrap staging
configuration; defaults and production release certification remain unchanged.
Seven generated collection orders were submitted against actual staging
PostgreSQL, with a controlled clock progressing from 16:00 to 19:10 and promised
times 17:30 through 21:00. Baskets included curry/rice, noodles/fish cakes,
crispy chicken/batched dumplings, ribs, sausage, and the exact £50 incident
basket and its £100 double. Server-calculated totals were checked.

The existing Admin lifecycle writer proposed a new time, the existing customer
response writer acknowledged it, and a later cancellation preserved the exact
started cooking job. The earlier retry, contention and failed-save checks also
passed in this run. An initial fixture spice mistake was rejected normally,
cleaned up and corrected to catalogue defaults before the passing run.

Probe version 6 returned PASS; version 7 disables it with HTTP 410. Post-run
SQL verified zero test orders, receipts and plans and unchanged staging totals
of 60 orders and 81 outbox events. Evidence is saved in
STAGING-FOUR-RING-SERVICE-RESULT.json. Local core regression suite: 294 passed.

This is a seven-order fixed-fixture collection-service test, not a full launch
certificate. Delivery, browser checkout/Admin coverage, completion/loyalty,
chef/vessel model gaps, and deployment rollback remain outstanding. No real
notifications were sent; production code, database and launch mode were untouched.

## 8 November: joined delivery rehearsal and per-dish holding check

The existing delivery-capacity component now accepts explicit server-only
stagingSharedRings configuration, passing it through both verification and
replanning. Default production bootstrap behaviour is unchanged.

Corrected validateFoodAge to check each finished dish at door arrival rather
than only the latest finishing dish. Intermediate frying and microwave preheats
are excluded when they have a subsequent cooking step. Standalone fried dishes,
dumplings and other finished auxiliary dishes are checked. Tests cover an older
dish hidden by a fresh final dish and the exact twenty-minute boundary.
All 296 core tests pass.

Extended the existing private hosted probe: the £50 and £100 baskets were
booked as deliveries, then a collection was added. Both driver reservations
remained, arrivals matched customer target times, and all kitchen work finished
by loading. Travel durations were fixed server-side five-minute legs, not live
Google routing. The earlier service, lifecycle, contention and failed-save
checks passed again. Probe version 8 returned PASS; version 9 disables it.
Post-run SQL confirmed zero test orders/receipts/plans and staging totals of
60 orders and 81 outbox events. Evidence: STAGING-FOUR-RING-DELIVERY-RESULT.json.

Outstanding launch gates include confirmed per-vessel portion capacities
(especially small versus large woks), remaining chef/model validation,
live-route and browser customer/Admin coverage, completion/loyalty and deployment
rollback certification. No production mutation or launch-control change occurred.

## 8 November: confirmed one-portion wok limit supersedes earlier batch evidence

David confirmed one main portion per small wok and conservatively the same for
large woks. Two-portion S&P Chips was observed but is not guaranteed capacity.
Shared-ring hot work now splits every portion into its own cook, including
noodles/fried rice. Allocator and independent/saved-plan validation reject
multi-portion wok jobs. Cold-preparation and the separate two-eggs rule remain.
Fryer validation now checks quantity at each exact main-cooking deadline, allowing
identical one-portion jobs to start together without borrowing frying from a
different batch deadline. All 298 core tests pass.

Current local results: original £50 and £100 fit with ten-minute hold; tripled
£150 is SEARCH_LIMIT/unverified. Mixed and starters/curries £150 retain checked
plans and lifecycle tests; stir-fry-heavy remains SEARCH_LIMIT; noodle-heavy
exceeds the current fixed-partition large-wok workload window.

Hosted version 10 of the combined rehearsal hit WORKER_RESOURCE_LIMIT after
four service orders. It is not a hosted pass for these new portion limits.
Version 11 disabled the probe. Four synthetic orders and a service plan remain
under prefix four-ring-race-30f27a27-b2a2-48a6-80ff-e419a151a78e-.
Exact cleanup SQL is staging-tests/cleanup-one-portion-rehearsal.sql.
The previously failing SQL-connector confirmation requires manual staging
cleanup if it remains unavailable. No cleanup success is claimed yet.

The probe source now separates fixed atomic, service and delivery phases into
individual invocations; bundle syntax checks pass. This split has not been
deployed or tested against PostgreSQL yet. Prior hosted evidence predates the
one-portion limit and must not certify the changed source. Production unchanged.

## 8 November: separated hosted one-portion rehearsals passed

User ran the exact interrupted-fixture cleanup. Read-only SQL confirmed zero
test orders and plans before the rerun. Probe version 12 then ran three separate
authenticated fixed-fixture phases, avoiding accumulated compute in one request:

- Atomic: same-key retries, changed-key payload rejection, concurrent distinct
  orders respecting capacity, and complete rollback after injected plan failure.
- Service: seven collection orders with the exact £50/£100 baskets, an
  acknowledged time change, and cancellation preserving started cooking.
- Delivery: £50 and £100 delivery baskets plus collection, retaining separate
  driver trips and door-arrival targets, with all cooking finished by loading.

All three phases returned PASS with the confirmed one-portion wok limits.
Delivery legs remain fixed five-minute server fixtures, not live route evidence.
Post-run SQL verified zero test orders, receipts and plans; staging totals are
60 orders and 81 outbox events. Probe version 13 disables the endpoint. Evidence:
STAGING-ONE-PORTION-HOSTED-RESULT.json. No production writes, notifications sent
or launch controls changed. Core tests remain 298 passing.

Remaining launch work: customer/Admin browser validation of the new scheduling
path, live-route coverage, completion/loyalty, remaining operational/model review,
and deployment rollback certification. The production candidate remains blocked.

## 8 November: hosted completion and loyalty passed

Extended the same bounded private probe with a loyalty phase using the actual
commercial validator, four-ring checkout, lifecycle writer and loyalty settlement.
A reserved test phone and unique example.invalid email were checked unused
before creating the synthetic account. Starting balance was 100 points.
The first £9 order reserved one £5 reward and four earned points; a second £9
order could not reserve the same reward. Checkout left the settled balance at 100.

An injected failure immediately after loyalty writes rolled back both balance
and order completion. Two concurrent completion requests then produced one
settlement: balance/lifetime earnings 4. Completing the second order resulted
in balance/lifetime earnings 13. A further cancelled order awarded no points.
Probe version 14 returned PASS; version 15 disables the endpoint.

Independent post-run SQL confirmed zero generated orders, receipts, plans,
customers and loyalty accounts. Baseline staging totals remained 60 orders,
81 outbox events and 177 points. No real notifications or production writes.
Evidence: STAGING-ONE-PORTION-LOYALTY-RESULT.json. This covers fixed synthetic
collection loyalty/completion; browser and deployment rollback gates remain.

## 8 November: actual staging deployment selects the four-ring candidate

Found and closed a deployment-selection gap: the deployed runtime's release
assessor had only selected the old single-wok model despite separate four-ring
tests. Release bootstrap now accepts the four-ring model only for a private
CANDIDATE_FOR_STAGING certificate with explicit FOUR_RING_ONE_PORTION_V1 config.
Production and CERTIFIED_FOR_STAGING certificates still reject this model.
The delivery component must declare the matching kitchen model. Default
single-wok behaviour is retained. New tests prove private candidate selection,
one portion per actual cooking job, production refusal and delivery mismatch
refusal. All 300 core tests pass.

Updated the private staging certificate; all release checks remain PENDING.
Bound source digest:
fdb81b10b40a8184e142fbc15ebac8a0206e35c018135187ec2a12c1c051dcfb.
Built the full deployment transport with existing private staging configuration
and deployed staging master-wok-booking version 46. Authenticated mode and
protected review listing returned HTTP 200; the Railway staging gateway also
returned LEGACY. Durable control remained LEGACY, approval null, revision 38.
No booking mode or production configuration was changed.

The candidate is now deployed but bookings remain disabled. Browser checkout
still needs integration for private fixture keys/example.invalid identities and
controlled staging launch approval. Browser end-to-end and deployment rollback
are NOT claimed passed. Production certificate/launch approval remain untouched.

## 8 November: private Preview checkout fixture adapter deployed

Website branch feature/basket-review-staging-2026-11-07 commit
5a7a0b0390bc75f5f4a335b4feedc0bedcfdb773 deployed successfully through Cloudflare
Pages (deployment c14b1dd8-53ad-418e-823a-9c69072af86a). Stable browser URL remains
https://feature-basket-review-stagin.rungsthaikitchen.pages.dev/ .
Only that exact hostname plus the exact staging gateway URL permits the proxy
adapter: it validates synthetic example.invalid email and browser UUID, then
adds the candidate's fixture prefix while preserving retries. Production and
other backends retain exact request bodies. All 36 website tests pass; remote
file baselines were compared before updating only the proxy and its tests.

Railway staging gateway still has booking mode LEGACY. Prepared patch
9bc78b27-aaf1-41f3-b550-63bfae84e45e contains exactly one staged variable change,
MASTER_WOK_BOOKING_MODE=MASTER_WOK for gateway service
fd320f7b-3e1d-4b07-970c-74b75fdc82d3 in master-wok-staging. Nothing applied yet.
Railway accept-deploy requires explicit deployment confirmation. No other
pending environment changes were present before preparing this patch.

The private Supabase launch control is also still LEGACY at revision 38.
staging-tests/enable-private-browser-rehearsal.sql prepares a guarded staging
approval under the writer lock; disable-private-browser-rehearsal.sql is its
staging-only drain/disable counterpart. Manual SQL is needed if the connector's
write confirmation continues expiring. Browser booking has not yet been tested.
Production remains unchanged and Legacy-authoritative.

## 9 November: real Preview checkout rehearsal and fixture-key blocker

User enabled the private database launch control: MASTER_WOK, matching release
master-wok-delivery-2026-11-04, revision 39. Confirmed by read-only SQL.
Applied the approved Railway mode-only patch; gateway deployment
6656ff3d-4cad-42ad-bb3e-f09c6fbe70b4 reached SUCCESS.

Authenticated the real Preview through Cloudflare Access and built the exact
incident £50 collection basket in the UI. An empty staging service date,
14 November, offered times including 20:15. Submission and same-key retries
failed safely; SQL confirmed zero orders created in the preceding hour.
13 November returned no slots with an older rehearsal commitment present;
that date remains a separate undiagnosed test-data/commitment case.

Added restricted server transaction diagnostics: enum-shaped error codes and
SQLSTATE only, no customer details, SQL, keys or arbitrary exception text.
The private fixture guard now distinguishes key/email failures without relaxing
it. All 301 core tests pass, including diagnostic privacy coverage. Deployed
staging master-wok-booking v48, source digest
548d4342792b8ce69ff169b50871668649595724c31c165fb63c37d33551c31a.
Browser retry logs identified PRIVATE_FIXTURE_KEY_REQUIRED. This proves the
writer receives a key outside its approved namespace; it does not prove which
upstream configuration/adapter caused that mismatch. Email was not the first
failing guard. Browser evaluation of email values is redacted and should not
be used to infer the actual field value.

Prepared the existing gateway's private staging key-prefix setting to guarantee
its outbound checkout keys begin release-nov6-delivery-. Patch
497abdf9-576a-4931-a0ea-363b89c83c6b contains exactly one staged change:
MASTER_WOK_STAGING_KEY_PREFIX=release-nov6-delivery- on the staging gateway.
Nothing applied/deployed from this patch yet; explicit accept-deploy confirmation
is the next step. Keep the browser's existing attempt reference for retry.

Production remains Legacy and untouched by these operations. Browser booking,
Admin lifecycle, the Friday commitment case and deployment rollback are still
unpassed gates. This candidate is NOT ready for production activation.

## 9 November: approved gateway prefix fix and hosted collection/Admin pass

Applied user-approved patch 497abdf9-576a-4931-a0ea-363b89c83c6b after confirming
it contained exactly the one staging gateway prefix variable. Railway deployment
886f6c12-5ee0-48a8-8c5e-4307a0857eea reached SUCCESS, no pending patch.
Retried the preserved real browser checkout: £50 incident basket became RTK-184,
order 3c5146c4-7583-4010-b9ad-dc6ebbbbcedc, collection 14 Nov 20:15. Eight item
lines, one receipt, four-ring plan revision 1, each hot job one portion. Key has
both proxy and gateway fixture prefixes; deterministic, within 128-character
limit, accepted by candidate. Avoid changing it while an attempt is pending.

Preview Admin accepted RTK-184, then proposed 20:20. SQL verified both 20:15 and
20:20 capacity commitments while pending customer acknowledgement. Exercised
the actual staging gateway customer acceptance HTTP route with its synthetic
response token: HTTP 200, customer_accepted_time, confirmed 20:20, retired token,
only 20:20 retained in the plan. No provider message was sent to a real customer.
Replayed the original writer request: HTTP 200, same RTK-184, replayed=true,
committed=false. No duplicate booking or checkout receipt.

Doubled the incident basket to £100 through the actual deployed runtime (API,
not browser): RTK-185, order 90657371-1114-4efc-bca4-0e905e0f0107, 14 Nov 21:00.
Committed beside RTK-184. Accepted through the actual lifecycle writer.
Both remain synthetic active staging commitments for rollback testing; no
loyalty completion/settlement was performed on these two orders.

The Friday unavailable date is explained by its pre-existing protected-v3 plan
(revision 1, updated 6 Nov 15:07), while candidate is four-ring. The explicit
SCHEDULER_MODEL_CHANGE_REQUIRES_DRAIN guard prevents mixing models. Do not erase
that unrelated fixture or claim arbitrary occupied-date compatibility.

Found existing Admin Refresh button had no listener. Added an authoritative
reload handler with failure message, preserving CRLF and the remote file
baseline. Pushed only admin.html to Preview branch with lease:
747ac7302cd6c5270c41299dee5794dd14253867. All 36 website tests pass. Cloudflare
Pages check completed SUCCESS, deployment b4012c6f-0acf-4d3a-9871-0f80d752f903.
Verified browser Refresh picks up RTK-185 changing PENDING -> CONFIRMED without
page reload. Screenshot evidence saved separately for receipt and Admin rows.

Remaining release gates include controlled deployment rollback, occupied-service
model cutover, current four-ring delivery integration/route evidence, and chef
attention/operating-model review. Larger £150 basket feasibility remains mixed;
never claim all large baskets fit. Production remains Legacy; no production
checkout/database changes were made. Candidate certificate checks remain PENDING.

## 9 November: controlled drain phase verified

User ran the guarded staging drain SQL: DRAINING, approved release retained,
revision 40. Independently read back. Public staging gateway /booking-mode
returned HTTP 503 (does not advertise Legacy prematurely); authenticated durable
mode returned DRAINING. New checkout path, a complete known-valid basket with a
new test key, original receipt replay and basket availability all returned 503.
An existing receipt is intentionally not replayed through the disabled writer;
its durable receipt remains available for operator reconciliation.

Before/after SQL confirmed both RTK-184/185 states and times unchanged, loyalty
unsettled, two receipts retained, and the 14 Nov service plan unchanged at
revision 6 / MD5 fee185d812666fdb2638f12c6b2d8a6c. No drain-test order created.
Ran the actual compatibility checkout client's capacityRows against these two
stored database rows: exactly 20:20 and 21:00 commitments preserved. This is
reader compatibility evidence, not proof of a full live Legacy booking.

The bounded Python HTTP diagnostic printed all expected results, then exited
with a trailing heredoc-marker NameError; that shell typo happened after the
requests and is not a writer failure. No request was retried to conceal it.

Prepared next rollback phase: Railway patch
540b15f5-5ef1-419d-88e9-e9d7004d746e contains exactly one staged variable change,
MASTER_WOK_BOOKING_MODE=LEGACY on the staging booking gateway. Reviewed whole
environment patch: no other services/shared/network changes. Not deployed yet;
requires explicit accept-deploy confirmation. Durable writer stays DRAINING.
Next verify terminal Railway SUCCESS, public Legacy mode, disabled private
writer, preserved rows/receipts/plan and safe Preview refusal of Legacy fallback.
No production operation was performed. Full rollback gate not yet passed.

## 9 November: staging gateway rollback deployed and verified

User explicitly approved the prepared rollback deployment. Re-read environment
patch 540b15f5-5ef1-419d-88e9-e9d7004d746e: exactly the staging gateway mode
variable, no unrelated changes. Applied it. Initial deployment
c97839f9-a947-4f08-924a-03cab431d6e3 FAILED before application startup: Railway's
mise dependency download returned HTTP 504. Reused previously successful
886f6c12-5ee0-48a8-8c5e-4307a0857eea build through Railway redeploy. Replacement
108ed875-290f-4c9f-9509-ed2372ce1569 reached terminal SUCCESS.
Fresh public staging /booking-mode returned HTTP 200 / LEGACY. Authenticated
writer mode remained DRAINING. SQL independently confirmed revision 40, both
booked order states/times unchanged, two receipts and byte-equivalent service
plan revision 6 (MD5 fee185d812666fdb2638f12c6b2d8a6c). No order deleted or
loyalty settled. This is a successful gateway switch / preservation rehearsal,
not certification of new Legacy checkout or provider/delivery rollback.

A read-only production /api/booking-mode request was denied HTTP 403 / 1010;
no current production HTTP mode was verified by that request. No production
configuration or data was changed. Production's previously established Legacy
setting has not been altered by this work.
Evidence: STAGING-ROLLBACK-GATEWAY-RESULT.json. Certificate checks remain PENDING
until all exact-release acceptance evidence, delivery and cutover gates are met.

## 9 November: isolated real-route delivery and food-age search repair

The shared-table four-ring harness correctly failed with MASTER_WOK_WRITE_REQUIRED
(SQLSTATE 42501) while the main writer was DRAINING. It created no shared orders,
plans or leftover contacts. Removed that duplicate experimental route phase;
kept a required expiry check for future four-ring probe builds.

Updated the existing delivery-browser-edge isolated rehearsal to use the actual
four-ring release assessor / commercial validator / driver planner. It creates
only a generated private schema with RLS and no API-role grants. Shared launch
control was never toggled. Probe versions 17/19 ran fixed £50 and £100 delivery
baskets to the public Morley Town Hall address using existing live geocode and
route functions. A £9 collection also committed without erasing either trip.
All three checkout retries returned their original order; three total receipts.
Changed-price and outside-radius (even free-delivery) attempts returned 409 and
created no order. No notification provider sends were attempted.

Delivery time proposal exposed a real integration defect: kitchen search first
chose a physically valid plan with excessive door-arrival food age, then refused
it without searching an admissible cooking arrangement. For the private four-ring
path only, the delivery component now supplies per-order earliest finish bounds
(arrival minus 20) to main, finished auxiliary and standalone-fryer scheduling.
Intermediate frying and preheating are excluded. A full-plan predicate continues
search after food-age failure, with the independent final age validator retained.
Protected started work and the old default model retain their safeguards.

Added the regression containing both £50 time alternatives, the £100 delivery
and collection. Initial complete search could hit SEARCH_LIMIT. Added necessary
forward feasibility checks; shared-ring coordination can skip equivalent vessel
occupancies (opt-in, same hardware class). Ring occupancy is maintained during
backtracking, and equivalent-vessel signatures are computed once per search level.
No search limit or holding allowance was increased. Removed an unsuccessful
partial-search optimisation. Profiled the actual regression before keeping the
performance changes. All 302 core tests pass; focused mixed regression ~1 second
in the local run (not a production performance SLA).

Hosted probe version 21 successfully proposed 18:35 for the £50 delivery while
retaining the other delivery and collection, accepted the synthetic customer
response, and replayed that response with committed=false. Final isolated plan
revision 5 passes independent validateFoodAge for every finished dish and retains
one portion per hot vessel. Live seven-minute outbound and return legs produce:
£50 revised loading 18:26, depart 18:28, doorstep 18:35, return 18:44;
£100 loading 19:21, depart 19:23, doorstep 19:30, return 19:39.
Three orders / three booking receipts / one response receipt. All isolated tables
have RLS; zero anon/authenticated/service_role/PUBLIC table grants. Retained the
private fixture evidence; no unrelated schema or order was deleted.

Deployed the repaired main staging runtime as master-wok-booking version 49,
source SHA d835202363fbacebe45f4553697489a18ce5f8207a26d6a50d8674c5170b33c7.
Candidate certificate remains CANDIDATE_FOR_STAGING with checks PENDING. Disabled
temporary probe as version 22 / HTTP 410. Main durable control remains DRAINING,
revision 40, gateway Legacy; main 14 Nov plan digest remains
fee185d812666fdb2638f12c6b2d8a6c. No production deployment or database change.
Evidence: STAGING-FOUR-RING-REAL-DELIVERY-RESULT.json.

This is real-route server integration evidence, not a completed browser delivery,
combined-trip, provider-send or delivery rollback certificate. Those exact-release
gates and final operating review/production approval remain.

## 10 November: combined-delivery Admin server flow completed

Recovered working source after maintenance; temporary logs/credentials had been
pruned. The prior interruption was an automatic approval-review usage-limit
failure while polling processes, not an unsafe-action determination. Read-only
staging SQL confirmed the background run completed: 20 Nov isolated plan revision
5, separate driver trips, combine/split audit decisions (prior revisions 2/4).
The test script had asserted a later collection retained the combined trip before
splitting; reaching the recorded split verifies that assertion completed.

Reused the same generated isolated schema with new expiring credentials. Existing
Admin operations recommended two nearby synthetic deliveries to public Morley Town
Hall / Library, saving 14 minutes. Preview did not commit; explicit confirmation
committed revision 3; stale revision 2 was rejected with 409. A later collection
preserved the two-stop trip at revision 4, and split restored separate trips at 5.
No customer promise header or production table was changed.

Fixed a reporting/ranking bug: the recommendation calculated food age from the
freshest dish. Actual saved combined plan contained dish ages 15,15,15,14 at the
first door, while Admin reported 14. Shared foodAgeAtStop now uses the oldest
finished main/standalone-fryer/auxiliary dish and excludes intermediate frying and
preheating, consistently with independent safety validation. Added full Admin
recommendation and stale-confirmation regression tests. All 304 core tests pass.

Hosted probe v24 returned 15-minute worst food age / 14-minute saving. Confirmed
again at revision 6 and independently verified saved plan foodAgeAtStop=15 and
validateFoodAge=true. Deployed repaired main staging runtime v50, source SHA
7a39b0c10314897ef539587dc9ef3e92d0537bdd634e55c5dad15997c75f2532. Main mode
remains DRAINING / revision 40. Disabled temporary probe v25, verified HTTP 410.
Evidence: STAGING-FOUR-RING-COMBINED-DELIVERY-RESULT.json. These are real hosted
Admin API/driver checks, not a completed browser Admin/checkout certificate.

Prepared the final private browser run: guarded resume-private-browser-rehearsal.sql
requires DRAINING revision 40 / matching release and returns MASTER_WOK revision 41.
Earlier SQL write confirmations timed out, so user execution remains the selected
manual SQL path. Railway patch 58bd7697-7852-4960-90a5-773b0b848cd6 contains exactly
one staged gateway MASTER_WOK_BOOKING_MODE=MASTER_WOK change, no other environment
changes. Not applied; requires explicit deployment confirmation. Main certificate
checks remain PENDING. Production remains untouched; reactivation is NOT approved.

## 10 November: private browser delivery and occupied-day performance repair

User resumed main private staging control to MASTER_WOK revision 41 and explicitly
approved gateway deployment; Railway 424c28ce-0727-43db-9a3f-3d4f71c3335b succeeded.
Production remains Legacy and untouched.

Browser exact original £50 basket submitted 21 Nov 18:30 as RTK-186
(6ea21032-00a4-4abb-92e4-c6daf43492fd), synthetic @example.invalid contact,
reserved fictional phone and public Morley Town Hall address. Admin Accept and
Suggest 18:35 succeeded. Real customer-response acceptance and replay returned
200; Admin Refresh now shows CUSTOMER_ACCEPTED_TIME / ACCEPTED 18:35. Trip modal
shows food ready 18:26, departure 18:28, door arrival 18:35, back 18:44.

The doubled £100 basket exposed main Edge CPU546 on whole-day availability.
Do not confuse this with a physically impossible basket. A limited 1000-node /
8-complete-check experiment avoided some CPU work but hid feasible times; removed
that release-assessor limit. Main v52 restored the full booking/hint search.
A gateway chunking experiment also failed hosted checks and was removed; no
Railway or website chunking deployment occurred.

Actual repair changes enumeration order: equally constrained time windows and
promises prioritise vessels with fewer eligible alternatives. An exhausted
heuristic search retries the original ordering to preserve existing £150 baskets
with different fryer/microwave pressures. Every attempt remains bounded and all
independent physical/food-age/coverage validators remain intact. No holding,
portion, equipment, business-hours or approval rule was relaxed. The tripled
original £150 basket now finds a physically valid plan; regression checks full
independent timeline coverage rather than requiring the old search-limit failure.
Mixed £100 delivery regression verifies valid plans even within a 1000-node /
8-check test budget, while actual release checkout/hints retain their full limits.

306 core tests pass (75.8 sec including fallback searches); backend 46 tests pass.
Deployed main staging v53, source SHA
f9f95cb967193a606b9765fe7ad442122ccd04e39de14fe71e85c85e4b0ef915.
Real full-day occupied-service availability returned HTTP200 in 10.77 sec:
49 hints, 46 available, 18:30/18:35/18:40 unavailable around existing trip.
bookingApprovalAllowed=false. Evidence:
STAGING-FOUR-RING-OCCUPIED-DAY-HINTS-RESULT.json.
£100 browser submission and its Admin verification are still being completed.
Candidate certificate checks remain PENDING; this is not production approval.

Browser completion: actual preview checkout now displays all repaired hints and
successfully submits doubled basket as RTK-187 (£100 delivery, 21 Nov 19:30),
id 9db930c4-d88d-4984-ac9b-7bccda5a6464. Admin Accept succeeded, notification
queued (no provider send claimed); row CONFIRMED. Trip modal matches saved plan:
food ready 19:21, departure 19:23, door arrival 19:30, back 19:39. Read-only SQL
confirms both £50/£100 headers and exactly one booking receipt per order. Main
21 Nov plan revision 6, model combined-kitchen-four-ring-staging-v1, MD5
fe98c31d035fee4f2983179a6cb6c2a1. Launch control remains MASTER_WOK revision 41.
Evidence: STAGING-FOUR-RING-BROWSER-DELIVERY-RESULT.json; screenshots under
/workspace/shared/master-wok-evidence/rtk-187-hundred-delivery-{receipt,trip}.png.

Remaining real gates: source/release packaging and exact-release certification,
provider delivery checks and complete rollback verification/operating review.
The failed lookup's old error message remains visible after recovered hints (UI
cleanup needed); no effect on locked transaction authority. Large £150 original-
order fallback tests can be expensive despite passing; broader hosted latency is
not proven. No production deployment is safe to declare from these tests alone.

## 10 November: release packaging and guarded certification path

Fixed stale checkout availability error: successful current-generation lookup
clears the old message/review button. Website preview commit
9dbba88aae9153dc2a47ba6551cc2c7159ef33c4; all 36 website tests pass.

Prepared production bootstrap for the same tested four-ring model/configuration.
The historic model identifier is retained; no silent plan migration or relabelling.
Private candidate still requires the private project/schema and fixture boundary.
A certified deployment requires exact source/project/schema/release/configuration
and all required checks PASS. DRAFT still cannot initialize a writer or connect
to the database. A matching durable operator approval is independently required.
Tests cover draft refusal, every pending required check, production fixture-prefix
refusal, mismatched binding/configuration, real four-single-portion assessment and
correct delivery-component wiring. No production infrastructure was changed.

Added separate master-wok-release-candidate.four-ring.production.json (DRAFT,
all checks PENDING), proposed release master-wok-four-ring-2026-11-10. Build with
--release-four-ring. The earlier single-wok delivery DRAFT is historical and is
not upgraded or used as this release's certification.

All 308 core tests pass in UTC (56.2s) and Europe/London (57.1s). Backend 46 pass.
Deployed the bootstrapping change to private staging only as Edge v54, source
73f69764108bcb777b3c1110d7a3644bbd1af7366a6afb0076449133f403026c.
See FOUR-RING-RELEASE-CHECKLIST.md for evidence limits and remaining real gates.

Post-deployment v54 read-only capacity checks passed: an additional £100 delivery
at already-booked 19:30 was unavailable (HTTP200, 11.16s), while 20:30 remained
available (HTTP200, 6.21s). Neither hint approved a booking. No new orders or
provider sends were made. FOUR-RING-RELEASE-MANIFEST.json pins runtime files,
separate DRAFT production certificate, preview/backend revisions and test counts.
The remote historical docs/shadow-service changes are preserved in the source
snapshot; no unrelated local working-tree changes are reset or committed locally.

## 10 November: hosted £150 CPU blocker fixed and actual bookings verified

The final hosted pressure check found v54 single-slot CPU failures for mixed and
starter/curry £150 baskets despite local feasibility. Temporary caching and job
pruning experiments did not resolve this and were removed before deployment.
The focused fix limits effort on the soft 10-minute preference before attempting
the approved 20-minute maximum. Fryer-dependent baskets try established job order
first; the alternative bounded ordering remains available. Suggestions and basket
review explanations use a separate bounded search and remain non-authoritative.
An exhausted hint is unverified, not proof the basket is physically impossible.
Locked checkout retains the full 20-minute maximum search and all validators.

All 309 tests pass in UTC (10.5s) and Europe/London (8.9s). New dedicated regression
independently validates both £150 baskets in the suggestion budget and checks
20-minute holding. Main staging v55 source:
a1230b05e03b5cdef91e923fb4c1c1feeef307eea1bc687cbebd012e5b9ace15.

Actual hosted whole-day scans on an empty 28 November returned HTTP200 for all
four examples: mixed 47/49 available in 9.79s; starter/curry49/49 in10.24s;
stir-fry0/49 in10.45s; noodles0/49 in9.43s. No crash or booking approval.
Then the two fitting baskets actually committed through the authenticated main
atomic writer as RTK-188 (£150 mixed,18:30) and RTK-189 (£150 starter/curry,20:15).
Each replay returned HTTP200/sameorder/committed=false/replayed=true. Read-only SQL
confirmed MASTER_WOK ownership, one receipt each, saved plan revision2/model4ring,
and maximum main hold20. No real provider calls or production writes.
Evidence: STAGING-FOUR-RING-LARGE-HOSTED-HINTS-RESULT.json and
STAGING-FOUR-RING-LARGE-HOSTED-CHECKOUT-RESULT.json. Production stays DRAFT and Legacy.

## 10 November: final actual browser enquiry and rollback guard handoff

Cloudflare session expired; owner completed secure email/code sign-in. The real
preview customer built 11 Pad Thai/Prawn (£110), synthetic name/contact, requested
28 Nov 20:15 on the service already containing the two £150 baskets. Whole-day
availability could not be checked; the existing failure escape path offered the
phone number and basket review. Sending the basket succeeded without an order.
Protected Admin displayed all 11 portions, protein, £110, requested time and the
explicit unconfirmed status. Mark contacted and Close review succeeded. Read-only
SQL confirms review79831cac-ef26-4115-8985-56d8a3deaf77 closed, zero customer orders,
main control MASTER_WOK revision41 unchanged. Assessment remained UNVERIFIED, not
a fabricated confirmed bottleneck. Screenshots saved under shared evidence.
Evidence: STAGING-BASKET-ENQUIRY-BROWSER-RESULT.json.

Prepared build-delivery-rollback-rehearsal.cjs and its generated SQL. They copy
RTK-186/187, their receipts and plan into TEMP tables only. The exact rollback
DO guard is reused with table targets changed to pg_temp; source SHA is recorded.
Cases cover missing drain, outstanding driver trip, cancelled/test order with
retained trip, future delivery order, unresolved past proposal, stale revision,
and record-preserving completed-service restoration. All table changes are TEMP;
script ends ROLLBACK. No permanent mode or order change is performed.

Supabase execute_sql confirmation expired before this TEMP rehearsal ran. Do not
mark the guard rehearsal PASS or retry through another writer. The generated
staging-tests/rehearse-delivery-rollback.sql is ready for the owner-selected SQL
Editor path. Production remains unchanged, and production certificate stays DRAFT.

The occupied-date scan's overload was fixed with a necessary bound per promised
time, in addition to the full-service workload bound. Distant accepted orders
must not enlarge an 11-noodle basket's own holding window. Regression rejects
that overload before search and still places six noodle portions. No capacity or
holding policy is loosened. All310 tests pass in UTC2.65s and UK time. Stagingv56
source f4dd2190e9037c0f1e1cb66d24c97d0af3fcd9610a385ac89358d8cbb25ae8e2.
Actual preview recheck now shows the normal no-online-time call/review popup, not
an availability error; saved basket/enquiry remains intact.

Production SELECT-only preflight: LEGACY revision4, old launch release, no current
or future orders. The13 unresolved Legacy proposals have tokens and service dates
Feb–Oct2026; these match the earlier explicitly approved historical-link retirement
scope. No new approval is inferred for production activation. No token, status,
price or other production value was changed. Final retirement belongs inside the
new guarded cutover transaction; the old SQL revision2 guard must not be reused.
