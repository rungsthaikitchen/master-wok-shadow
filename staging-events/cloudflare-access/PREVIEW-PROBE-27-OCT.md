# Temporary preview authentication check

Expires: **27 October 2026 at 22:23:24 UTC (UK time)**.

Deploy only `deployment/preview-access-check.js` as
`functions/admin-api/access-check.js` on the isolated website preview branch.
Use `deployment/preview-access-routes.json` for that branch's `_routes.json`.
Do not deploy to main or merge the isolated preview tree into main.

The exact branch origin and preview application AUD are embedded server-side.
The only outbound operation is fetching the pinned team's public signing keys.
No database, order action, notifications, env credentials or identity output.
GET only; other hostnames, queries and methods refuse. At expiry it returns 410
without fetching keys. Remove the temporary route and file after owner testing;
automatic expiry is the backstop, not a claim that the deployed file is removed.

Validation: all 68 Node tests passed in both Europe/London and UTC, including
the exact standalone bundle, missing assertion, wrong host, POST, valid synthetic
signature and expiry. The workerd smoke passed with one locally intercepted key
request and zero booking/database/notification requests. Real hosted Access
assertion verification remains pending the owner's signed-in browser test.

Owner test: visit the exact preview origin plus `/admin-api/access-check` after
Cloudflare login. Expected response is `VERIFIED`, scope
`ACCESS_READ_ONLY_PROBE`, and all three request/action counters zero. Share only
that JSON result; never cookies or assertions. The existing order routes remain
disabled throughout. Production website main was checked before deployment and
was unchanged at `9e944039a7d1dca9d6a2e2f3995cac589c93ea27`.
