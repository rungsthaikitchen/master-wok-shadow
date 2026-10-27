# Protected preview to staging fixtures — review package

Status: implemented and locally tested, **not deployed or enabled**.
The owner's real preview Access-only probe passed earlier. That verifies the
identity boundary; it does not verify this hosted database connection.

## What is prepared

`preview-fixture-api.mjs` pins the preview team, audience and exact branch origin.
It signs state reads and versioned staff commands. The separate receiver verifies
the signature, age, fixture UUID, allowed targets and input contract before a
budget or database operation. An actor is a keyed pseudonym; it remains sensitive
audit data. Raw Access assertions, subjects, emails and cookies are not forwarded.
Keys are 32 random bytes, represented by 64 lowercase hexadecimal characters.
Use independently generated hop and actor keys, stored only as server secrets.

Both factories default off before reading configuration. Enabled runs require
an explicit deadline no more than ten minutes ahead. The Railway receiver also
pins the existing staging project/environment/service and staging-only DSNs,
requires all other Master Wok flags off and refuses launch at/after the fixed
fixture cutoff of 28 October 16:30 UTC. It provides one exact POST endpoint,
bounded JSON bodies, no redirects, no credential forwarding, no automatic retry
and no public health/data endpoint. It does not import production backend code.

`railway-shadow/preview_browser_receiver.py` uses the existing separate reader
and writer roles. Reads use a read-only transaction and a single state/revision
query. Writes use the existing atomic staff-command transaction. A persistent
SQLite budget at `/data/preview-browser-28-oct-v1/budget.sqlite3` allows one start,
160 HTTP attempts, 60 state reads and 20 commands. Budget exhaustion/expiry or a
restart refuses further work. Do not delete/reset that journal to rerun a trial.
Expiry stops the receiver; an external administrative cleanup must still disable
the fixture and revoke the trial grants. Earlier hashed preview deployments are
also bounded by the same expiry and the receiver's shutdown.

The new fixture and SQL seed/activation/cleanup files are candidates only. Seeding
finishes with the new stream disabled. Activation requires no other enabled
stream and exactly the fresh two-event, zero-audit fixture. Reader access adds
only the required booking columns and a fixture-specific RLS policy. Activation
and cleanup must be paired with a pre-trial privilege snapshot: do not revoke a
grant independently added by other work. No schemas, grants, flags or data were
changed on either Supabase project in this development stage.

`build-preview-fixture.mjs` generates a separate eight-file deployment package.
Its checked-in build is disabled; this is not the current website deployment.
An enabled build needs an explicit endpoint and fresh deadline. The endpoint must
first be verified from the exact staging Railway service's domain metadata;
matching a Railway hostname syntax alone does not establish service identity.
The endpoint is then embedded server-side, never chosen by browser input.
Server bundles read hop/actor secrets only when explicitly enabled. No secrets
are in the browser bundle or committed manifest. Do not merge the isolated
preview branch/tree into production main.

## Verification

- 83 Node test entries passed in Europe/London and UTC.
- 16 Python tests passed in both timezones, including HTTP handling, pinned
  configuration, fixed SQL, budget reopen/exhaustion and concurrent budget claims.
- Eight real Chromium cases passed with the pinned-preview adapter, and the
  original eight synthetic-adapter cases still pass: actual reload, lost-success
  retry with the same command ID, revision-conflict review, session expiry,
  cancellation and storage failure before sending.
- workerd passed four boundary cases through intercepted fixed key/service HTTP
  hops into the local signed receiver and SQL: three signed service requests,
  one audit row, one provisional hold, no external or production requests.
- A cross-language test passed a JavaScript-signed envelope into the exact Python
  receiver validator. The SQL fixture, temporary reader ACL and cleanup passed
  locally, including revocation of reader booking access and staff execution.

All database lifecycle tests use local synthetic SQL fixtures. The Python SQL
transport tests use injected connections; real psycopg/role/ACL verification for
this new receiver remains a hosted-trial dependency. This stage does not claim
production schema compatibility, real Access browser command verification,
continuous observation, scheduling accuracy or actual kitchen activity.

## Hosted launch and shutdown sequence

1. Install `MASTER_WOK_PREVIEW_HOP_KEY` and `MASTER_WOK_PREVIEW_ACTOR_KEY` as
   **Preview-only encrypted Cloudflare Pages secrets**. Put only the same hop key
   on the existing Railway staging service. Keep actor key out of Railway.
   Never paste values in chat, commit them or put them in client JavaScript.
2. Check service/domain identity and current temporary ACLs. Seed the fresh
   disabled fixture; preserve a privilege snapshot. Reuse the existing service,
   volume and staging reader/writer DSNs. No new persistent service or monitor.
3. Pin the reviewed commit, set start command to
   `python railway-shadow/preview_browser_receiver.py`, retain restart NEVER,
   and keep `MASTER_WOK_PREVIEW_BROWSER_ENABLED=false` for the initial deploy.
4. Coordinate a fresh ten-minute deadline, trial ACL activation, receiver flag
   and enabled preview build. Only the fixed synthetic order is accessible.
   If the window is missed, do not reset journals or silently extend the trial.
5. Verify actual hosted state, offer/confirm/cancel/complete and same-ID retry
   receipts, plus event/audit/reservation counts. Use a second fresh fixture for
   mutually exclusive terminal paths; do not reset the first order's history.
6. Restore default-disabled Pages bundles, turn the receiver flag off, disable
   the stream, restore ACLs from the snapshot and verify no active holds/sessions.
   Export the new evidence, retain its journal and remove unused public routing.

## Current access dependency

Railway metadata was read successfully: the existing service is still pinned to
`f94d473909cf89b64f6f525b9014a4484f9a084e`, running the disabled prior one-off
trial with restart NEVER and private networking only; no staged changes exist.
Cloudflare Pages encrypted secret management is not exposed by the connected
tools. Private preview configuration must be set through an authenticated
dashboard or an appropriately scoped Cloudflare integration before activation.
Do not expose keys in screenshots. No additional paid infrastructure has been
provisioned, and no hosted trial was started in this stage.
