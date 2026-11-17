# Production availability cutover — 17 November

Website and booking runtime are deployed. The exact reviewed runtime was read back as production Edge v23. Master Wok is active at durable revision 11, the gateway reports MASTER_WOK, service control is normal and ordering is reopened. The existing notification worker is healthy with no pending queue.

415 backend/package and 92 website tests passed. The live browser verified the maintenance pause refused checkout, then opened checkout after reopening. Four live availability requests completed HTTP 200. The workspace/browser disconnected before the final dropdown and submitted-order check could finish. No production test order was submitted or created; owner submission/Admin/notification smoke remains pending. Do not describe that final test as complete.

The old explicit Legacy gateway flag was found during routing verification, ordering re-paused, both gateway environment values aligned and the same known backend build redeployed before final reopening. No orders were created during that interval. Full versions, source identity and verification scope are in PRODUCTION-AVAILABILITY-CUTOVER-2026-11-17.json.
