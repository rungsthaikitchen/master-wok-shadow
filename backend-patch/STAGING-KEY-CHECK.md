# One-shot staging key authentication check — 23 October 2026

This is an authentication/read compatibility check for the new Supabase secret key. It does not validate booking lifecycle writes, loyalty, notifications or production access. Staging public.orders exists; public.loyalty_accounts does not, as confirmed with metadata-only SQL on 23 October. No table is created for this check.

## Existing service only

Use master-wok-continuous-comparison-staging, service 012e5ef6-6225-4ab3-95f5-894583db7e83, environment c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279, project 7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8. Reuse its existing /data volume; do not add a service, volume or public domain. It was last observed with all event trials disabled. Current dashboard state must be checked before deploying; OAuth inspection is unavailable.

The dedicated Dockerfile installs the pinned backend compatibility dependencies. Existing event-runtime Dockerfile and default-off observer are not modified. This temporarily changes the start command of this staging test service only; no production service is involved.

## Phase A: deploy disabled

1. Confirm the existing service/environment names and /data volume, Restart Policy Never, and absence of unrelated staged changes. Keep every other event/booking/delivery/monitor trial flag false. Do not apply unrelated pending changes.
2. Source remains rungsthaikitchen/master-wok-shadow, branch delivery-route-staging. Use the exact reviewed commit including this check, not the previously pinned 20d9dc9 revision. Verify the deployment commit link after deployment. Do not choose the old build through Redeploy.
3. Configure Dockerfile build using railway-shadow/Dockerfile.key-compatibility and start command python railway-shadow/key_compatibility_staging.py. No HTTP healthcheck, port/domain or cron is needed for this one-shot process. Root directory remains repository root.
4. Add MASTER_WOK_KEY_COMPATIBILITY_ENABLED=false. Do not provide a secret yet. Deploy the selected reviewed commit once (Deploy Latest Commit on the connected branch if needed). Expected runtime log: status DISABLED, requests 0, buildSha equal to the deployment commit. The process exits successfully and can show Completed rather than a continuously running server; that is expected.

## Phase B: run once after disabled code/version verification

1. In the staging Supabase project hvrqgufqjslvgiohgkvu, privately copy the existing new-format secret, not its publishable key and not the production secret.
2. On this same existing Railway staging service, add MASTER_WOK_STAGING_SECRET_KEY using its secret variable editor. Do not put the value in chat, source, logs, a screenshot, a command line or a file download. Leave old service variables unchanged.
3. Set MASTER_WOK_KEY_COMPATIBILITY_ENABLED=true, keeping other trials false, and deploy once. No separate SUPABASE_URL variable is used: the staging URL is compiled into the check.
4. Expected result: PASSED, requests 2, source STAGING_ONLY, customerRows 0, writes 0, notifications 0, bookingLifecycleVerified false, and the reviewed buildSha. SDK table SELECT and direct HTTP GET both request select=id&limit=0. No customer IDs or records are returned or logged. This proves the key is accepted on the tested staging read paths only.
5. On failure, do not repeatedly deploy or remove the marker to retry. The persistent /data/key-compatibility-23-oct-v1.started marker is consumed before networking and blocks repeat attempts. Logs deliberately omit exception text to avoid leaking secrets. ALREADY_ATTEMPTED is not a pass. Investigate the cause and explicitly prepare a new bounded attempt if warranted.
6. Set the enable flag false and remove the dedicated test secret variable after evidence is recorded, then deploy disabled. Verify DISABLED/requests 0. Keep other trials disabled. Preserve the attempt marker. Revoke a test-only key if one was created solely for this check; do not revoke a shared existing staging key without mapping consumers. Removing a variable does not revoke its value at Supabase.

This run neither rotates production credentials nor closes the complete backend migration gate. Further staging lifecycle fixtures are needed for loyalty/admin behaviour; production still requires coordinated consumer migration and old-credential revocation.

## Validation

15 offline tests passed (nine backend credential tests plus six staging check tests), no skips, using the exact deployment archive server.py. Coverage includes disabled no-network startup, exact staging identities, other-trial refusal, no legacy fallback, zero-row requests, no redirects, durable no-repeat on success/failure, client closure, unexpected-row refusal, and sanitized failure logs. The dedicated Docker image and real staging authentication have not yet been run. Existing 97 event tests already passed against the archive; event-runtime code is unchanged.

## Hosted evidence — 23 October 2026

The owner supplied Railway runtime logs from the exact staging service/environment above. These are owner-provided logs; connector read-back remains unavailable due to OAuth. Build SHA in both runs is 33d21ba7b3b213f2f03a9e123ed4fc805f88c429.

| Deployment | UTC observation | Result |
|---|---|---|
| 6af8b243-68f1-4d97-8024-87c9968900ef | 2026-10-23T04:45:49.885044033Z | DISABLED, requests 0 |
| 737f1d05-bca6-4fba-8b89-fb8d406137c1 | 2026-10-23T04:48:49.752415709Z | PASSED, requests 2, source STAGING_ONLY, customerRows 0, writes 0, notifications 0, bookingLifecycleVerified false |

This supersedes the earlier not-yet-run status: the dedicated image ran and both new-key read paths passed in hosted staging. It does not validate booking/loyalty mutations, notifications, the complete backend service or production credentials. The startup logs show volume attachment on both deployments; contents and attempt marker have not been independently inspected.

Cleanup pending: set MASTER_WOK_KEY_COMPATIBILITY_ENABLED=false, remove MASTER_WOK_STAGING_SECRET_KEY from this service, deploy disabled, and record DISABLED/requests 0 on the expected build. Retain the attempt marker and existing shared staging key; removing a service variable does not revoke a key. Do not resume other staging trials or change the live backend as part of cleanup.

Cleanup execution subsequently observed in owner-provided logs: deployment ddb30f62-7737-4d2b-96c9-4d8693aeb3cd, build d5bf1000b269f4f589316ac1cab6a9635a40946f, 2026-10-23T04:52:15.595556678Z, DISABLED/requests 0. Variable deletion is not visible in this log. See BACKEND-KEY-TRIAL.md for the next isolated synthetic handler trial; no real hosted write/lifecycle pass is implied by the preceding read-only check.
