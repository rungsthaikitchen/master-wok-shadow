# Website publishable-key rollout — 24 October 2026

Completed with limits below. Owner saved RTK_EDGE_PUBLIC_KEY_MODE=dual. Both the real legacy anonymous JWT and the real publishable key then reached normal incomplete-payload400 validation on geocode-address, get-delivery-route-quote and geocode-order. No Google calls, order updates or other DB operations occur on those paths. The first admin-function checks hit a connection-level tunnel failure; one bounded identical retry passed for both keys. That failure was not misclassified as an application denial.

Website main was independently rechecked at cb39250cc2d1d6de03b090a8183db4ae5ba30c62. Prepared commit b4db919971e6163f014bed29892176ccfa42a5b1 was exactly one commit ahead, with only index.html/admin.html changed. Both prepared files contained the current project's publishable key and no legacy JWT literals. Main was advanced using that expected SHA, without force. No newer website changes were overwritten.

Cloudflare Pages check completed SUCCESS for b4db919. Deployment id7522f4b1-0663-42fb-b00f-0dcbc2bb4b45. The public homepage at https://rungsthaikitchen.co.uk/ returned200 with the expected publishable key and pinned2.118.0 SDK, and no legacy JWT literals. The pinned jsDelivr SDK returned200 and its bytes exactly matched the locally tested npm UMD artifact (218252bytes; SHA256ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3).

The admin URL redirected to the expected Cloudflare Access login wall. Its authenticated served content and interactive UI were not independently verified; no login was attempted and no preview/alternate domain was used to bypass access control. Its repository source was checked and is included in the successful deployment. Evidence records only the redirect host, never login tokens/query parameters.

No live booking was submitted. No production database write, notification, payment or Google routing/geocoding request was performed by these checks. This is deployment/transport compatibility evidence, not an end-to-end booking or signed-in admin acceptance test. Existing capacity and order-handling logic were not edited.

Keep dual mode during the overlap so old open/cached browser pages continue working. No key was revoked, and mode was not changed to publishable-only. Global legacy-key retirement still needs remaining function/source, shadow-runtime and external-consumer inventory. A publishable-only cutover must consider old client sessions and be verified before legacy deactivation; do not assume this website rollout completes every consumer migration.

Machine-readable evidence: WEBSITE-ROLLOUT-RESULTS.json. Original local15-test results and hosted mode matrix remain in RESULTS.json. No tests were rerun unnecessarily because no implementation changed between the tested candidate and this deployment.
