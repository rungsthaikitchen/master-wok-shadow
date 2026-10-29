# Preview recovery and fresh disabled preparation — 29 October

Scope is the existing Railway staging receiver and Supabase staging project
hvrqgufqjslvgiohgkvu only. No production writes, customer notifications, website
main updates or trial extensions are included.

## Verified recovery

Disabled deployment a6a5faa3-3ffb-41af-9358-474a79867fe4 built and deployed
successfully on 29 October; runtime logged DISABLED / sourceRequests 0.
The public endpoint remained absent.

The old diagnostic incorrectly reused the active trial deadline check, preventing
read-only inspection after expiry. Commit 5628a0912ff6b60c77e4f283c989cf37b87645d9
separates pinned scope/key/connection checks from the active deadline guard.
Diagnostics still require the trial flag false and exact staging scope. They do
not start HTTP, consume/create/reset a budget, or change the configured deadline.
Active configuration still enforces both the short window and the absolute cutoff.

Unlike the earlier old-snapshot redeploy attempt, the diagnostic source and start
command were staged together for this service only and explicitly committed.
Deployment ee59fc87-5e51-4885-ace2-90967e1d4092 completed successfully, logging:
DIAGNOSED, PRIVATE_STAGING_READ_ONLY, configurationVerified true, roleVerified true,
fixtureEventCount 2, fixtureEnabled false, budget null, productionWrites 0 and
notifications 0. Thus no version-two budget file existed at inspection; none was
created. Version-one spent journal and all prior fixture histories were preserved.
The normal disabled receiver start command was restored without redeployment.

## Separate version-three candidate

The candidate now binds fixtures/preview-browser-29-oct-v3.json and a separate
/data/preview-browser-29-oct-v3 journal directory. It has a new stream, route,
booking and alias; no previous history or allowance is reset. The seed uses the
existing staging booking functions in a transaction and finishes disabled.
Independent staging query confirmed two version-three seed events, zero staff
audit rows, zero enabled streams and zero active holds (reservations on enabled
streams). Version two still has its original two events.

Pre-trial privilege snapshot confirmed all temporary booking/route reader grants,
writer route SELECT, reader/writer audit privileges and staff/routed execution
remain revoked. Version-three activation and cleanup scripts retain the corrected
three-column reader route grant and its inverse. These scripts are prepared, not
applied. The fixture is disabled and no temporary policies were introduced.

Both Pages and receiver enforce a fresh window of at most ten minutes. The absolute
cutoff is 29 October 16:30 UTC; after that, prepare another dated fixture rather
than extending the old candidate. Pages artifacts are built disabled. Website main
and the isolated preview branch have not been changed in this preparation.

Validation: 83 Node tests and 19 Python tests passed in both Europe/London and UTC.
The Python state stub now derives its target from the selected fixture. A separate
historical hosted-fixture regression shifts dates only in its local SQL copy to a
future service day; committed historical fixture SQL, runtime guards and hosted
evidence remain unchanged. The earlier test failures were stale test data, not a
reason to relax runtime date validation.

## Next bounded browser test

First deploy this candidate disabled and verify its actual source/start snapshot
and DISABLED runtime log. Have the owner authenticated to the existing preview
Access application before starting a timer. Verify any temporary domain against
the exact approved staging service. Prepare the cleanup backstop and preserve the
new journal. Only then apply temporary staging activation, build/deploy the fresh
short-lived preview and enable the receiver within that same deadline.

Exercise a state read, offer, exact retry and conflict handling, then confirm and
cancel the synthetic booking. Check one hold after offer/confirmation and none
after cancellation, exact event/audit counts and persistence. This is synthetic
workflow evidence, not real booking or kitchen performance. Close the stream,
revoke temporary privileges, remove only the temporary domain and restore the
disabled preview immediately afterwards. The receiver's hard expiry is independent.
