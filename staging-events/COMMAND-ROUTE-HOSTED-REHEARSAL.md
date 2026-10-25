# Hosted command-route rehearsal — 25 October 2026

The bounded synthetic staging rehearsal passed. This establishes the new route-lock and restricted runtime behaviour for a single same-day handover. It does not establish complete production booking-event capture or authorize live scheduling changes.

Runtime commit: `5fd8f85758ed5a59a8ede9d9391a5adfcaed4895` on `review/cutover-fixtures-2026-10-24`.

## Actual hosted results

| Check | Observed result |
| --- | --- |
| Routed writer commits before switch | Administrator was witnessed blocked by the writer; the committed proposal appeared in the baseline and sealed retired prefix. |
| Routed writer waits behind committed switch | Writer was witnessed blocked; the reader still saw generation zero while the switch was uncommitted. After commit, the command recorded in the destination. |
| Routed writer waits behind rolled-back switch | Reader saw only the committed original route. After rollback, the waiting command recorded in the original stream; destination remained empty. |
| Route lock timeout | PostgreSQL returned `55P03`. Retrying the same request recorded once, and the next exact retry returned `ALREADY_RECORDED`; no partial event was retained. |
| Restricted router and observer | Actual separate reader/writer DSNs were used with role and privilege checks. Runtime accounts could not mutate routes or execute the administrator switch. |
| Signed response HTTP | Eight loopback HTTP requests exercised authorization, extra-field refusal, old-origin acceptance, exact retry, stale rejection refusal and current-origin rejection. No public endpoint was created. |
| Interrupted observer handover | The trial injected failure after both journals were acknowledged but before the route checkpoint. The observer became unhealthy; a new instance required a fresh read and recovered without duplicate comparisons. |
| Between-poll decision | Retired source sealed at 3 events and retained 2 decisions. Destination finished at 4 events and retained 1 decision. The baseline itself contributed no decision. |

An independent management SELECT read back all four final routes. The first order ended `customer_declined_time` with zero reservations. Committed-switch route: generation 1, destination 2 events, retired source 2 events. Rolled-back and timeout routes: generation 0, original source 3 events each, empty destinations.

Enabled deployment `ee1376dd-39e8-49cd-98e3-d28870ef1eae` completed SUCCESS with an OBSERVED result. Runtime witness ran from approximately 07:36 to 07:38 UTC. Durable budgets recorded: one start, 15/16 read operations, 13/16 write attempts and 52/180 probes. Budgets count operation attempts, not every internal role-check SQL statement. The runner has a maximum ten-minute deadline, fixed project/environment/service identities and mutually exclusive trial flags.

The first enabled build `5cedc6d0-fc0a-4caf-94a0-e6b8fa225853` was superseded while waiting at the builder. It produced no runtime evidence. Redeploying the known build produced the successful run; one-start persistence prevented a second trial execution. The initial disabled deployment `86c77b65-e64c-45e6-b714-519083dbb2fc` made zero source requests.

## Code, tests and reproducibility

- `railway-shadow/event_command_route_trial.py`: default-off bounded runner. Administrator switching stays outside the runtime account.
- `command-route-trial-fixtures.sql`: dedicated synthetic identities, all streams disabled at fixture commit. Do not rerun against existing identities or reset their history.
- `command-route-admin-before.sql`, `command-route-admin-after.sql`, `command-route-admin-rollback.sql`: externally controlled transactions. The 12-second holds deliberately create witnessed contention; they are test controls, not application behaviour.
- `fixtures/command-route-runtime-hosted-captures.json`: independent synthetic final exports, containing no real customer data.
- `command-route-runtime-results.json`: deployment, witness, budget and cleanup evidence.

Local final validation: 26 Python tests and 12 Node test entries passed in each of Europe/London and UTC. The Python set includes two independent hosted-capture replay/restart tests. These local capture tests complement the actual hosted observer run; they do not replace it.

Supabase installed private migration `master_wok_private_command_route_candidate` and then applied `master_wok_command_route_trial_revoke_runtime_grants`. All functions remain SECURITY INVOKER with no anonymous, authenticated or service-role grants. RLS is enabled on the private route table. The before/after security-advisor results were unchanged: two existing informational no-policy notices on unrelated private delivery-test tables; no new notice was introduced.

## Shutdown and remaining integration work

The trial flag was returned to false and its deadline to zero. All eight trial streams were disabled, and the new reader/writer route SELECT and function EXECUTE grants were revoked. Independent checks found zero enabled staging streams, zero active runtime sessions and no remaining runtime route/export/response access. SQL and synthetic audit rows remain private for review. Journals remain on the existing volume; do not delete or reverse their route pointer to simulate rollback.

Cleanup deployment `a4b346bc-6c98-4cc1-bfb9-6aa02559178c` completed SUCCESS and logged DISABLED with zero source requests.

No production database writes, notifications, availability changes, checkout changes or production deployments occurred. The existing staging service and 500 MB volume were reused; no infrastructure was provisioned.

Next, resolve the [live writer inventory](BOOKING-COVERAGE-AND-HANDOVER-REVIEW.md), particularly the active but unreadable `order-confirm`, direct admin writes, alternative checkout paths and the different legacy confirmation contract. A production capture proposal must describe every mutation boundary and atomic event/reservation update before any live change. Continue treating polled production state as `UNVERIFIED` decision-history evidence.

Multi-hop, connected-service-day routing, unattended route cutover, continuous observer scheduling and public health integration remain outside this bounded rehearsal. The result proves the covered staging paths, not these additional behaviours.
