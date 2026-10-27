# Hosted synthetic staff-command acceptance — 27 October 2026

The bounded rehearsal passed on the existing Railway staging test service and Supabase project hvrqgufqjslvgiohgkvu (Postgres 17.11). No additional service, volume, domain, tracing or paid resource allocation was created. Existing resource consumption was reused; incremental billing was not measured. Production Supabase, live booking/availability and customer notifications were untouched.

Runtime commit: f94d473909cf89b64f6f525b9014a4484f9a084e, pinned to staging service 012e5ef6-6225-4ab3-95f5-894583db7e83 in environment c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279. Six fixed collection fixtures use 28 October service targets, two baseline events each and no real customer data.

## Witnessed outcomes

| Case | Hosted evidence | Result |
|---|---|---|
| Same command ID | Separate writer PIDs; waiter blocked on holder; uncommitted event and staff audit invisible to reader | RECORDED then ALREADY_RECORDED; one new event/audit |
| Competing proposals | Separate writer PIDs; same blocking/invisibility witness | Second command STAFF_REVISION_CONFLICT; one new event/audit |
| Holder rollback | Separate writer PIDs; waiter blocked until rollback | Waiter RECORDED; one new event/audit |
| Lock timeout | Held stream row, second real connection SQLSTATE 55P03 | Same-ID retry RECORDED then ALREADY_RECORDED |
| Final audit failure | Actual runtime-role INSERT denied by fixture-specific RLS after booking/event function | SQLSTATE 42501; event, audit, original hold and booking command counts unchanged |
| Signed local HTTP | Node Access signature and HMAC receiver, authenticated loopback, real runtime SQL | Invalid identity blocked; committed offer loses application success; simulated reload retries exact ID once; cancellation releases hold |

Direct concurrency cases exercise the SQL contract using a synthetic actor ID; the signed HTTP case separately exercises provenance through the Node sender/receiver. They do not establish that real browser identity traverses deployed Pages/Railway endpoints. HTTP loss was injected after commit before application success, not physical packet loss. The embedded receiver uses ephemeral synthetic keys; no real keys were published, read or changed.

The runtime checked reader/writer identity, non-superuser/non-bypass-RLS status, absent audit editing/route mutation rights and enabled-stream control restrictions. It used READ COMMITTED, one persistent start, 13 bounded writes, 22 reads and four lock probes within a nine-minute deadline. It ran once with restart policy NEVER. Evidence stays on the existing volume in /data/staff-command-trial-27-oct-v1, including attempts.sqlite3, result.json and packets.json. That spent run directory must not be reset/reused to retry the trial.

## Independent read-back and replay

An independent administrator query found exactly 18 booking/event command records, six staff audit rows and zero orphan audit links. The audit-denial fixture retained exactly its two baseline events and original proposal; the HTTP booking was cancelled with no remaining hold. Five synthetic holds remained on the other streams as evidence, and those streams were subsequently disabled. These holds do not reserve live capacity.

The exact hosted engine exports are committed in fixtures/staff-command-hosted-capture-27-oct.json. Node chronological replay produces eleven SUGGESTED observations and five remaining hypothetical commitments. Python imports each into a durable shadow journal; reopening all six journals produces IDLE with no duplicate observations. All results retain verified=false: proposed work is never treated as confirmed cooking/driving activity or as proven capacity accuracy against a real service.

After adding the captured regression checks, 55 Node entries and six Python tests pass in each of Europe/London and UTC. The earlier local Workers-to-SQL checks remain separate from this hosted database evidence.

## Deployment and shutdown

- Disabled preparation: 0eb0fe1d-fb8f-4bd1-bf2f-dfa5e6945508 — SUCCESS, DISABLED, sourceRequests=0.
- Enabled trial: e411e17e-cfb0-4ba9-b101-fbfdd2c2a5e2 — SUCCESS, OBSERVED, scope SYNTHETIC_STAFF_COMMANDS, productionWrites=0, notifications=0, verified=false.
- Cleanup: b908c8c9-3752-45ad-bd64-751556924148 — SUCCESS, DISABLED, sourceRequests=0.

Independent final checks: zero enabled streams globally, zero active synthetic holds, zero reader/writer sessions, no writer/reader access to staff audit, no route SELECT for writer, no staff/routed function execution for writer, no application-role execution. All other trial flags were explicitly disabled; the successful runtime configuration validated them before any DB call. No staged Railway changes remain. Existing create/apply-booking grants were preserved. Synthetic audit/event records remain on disabled streams for review; they were not deleted or rewritten.

The three staging migrations add the private SECURITY INVOKER candidate, temporary fixture-specific ACLs and their revocation. No SECURITY DEFINER or broad application grant was introduced. Security advisors finish with only the same two pre-existing INFO notices for unrelated private delivery-test RLS tables.

## Remaining integration and deployment plan

This proves the hosted synthetic command/event/reservation/audit transaction under contention. It does not activate producer capture or validate all real lifecycle writers.

Next prepare a concrete staging admin adapter diff that carries this versioned intent/actor contract through the actual server hop. It must preserve existing action semantics, keep customer proposal responses separately revision-bound, refresh current state after a historical replay receipt, and define conflict/reload handling for a real browser. Route cutover retries and actor-key rotation still need contracts. Then rehearse hosted staging UI/API end to end before considering any live change.

Before live producer integration, review order-confirm source coverage, guest/customer/address authority, remaining direct writers, audit export/retention and read-only observer completeness. Existing broad public Supabase policies remain a separate hardening dependency. Production scheduling stays unchanged; production Supabase writes remain prohibited. No new approval request is needed for the completed staging run under the standing authorisation.
