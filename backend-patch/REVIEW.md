# Backend integration patch for review

This is a concrete, default-off patch to the owner-supplied Railway server.py, not a production migration or completed live event-capture implementation. No deployment is requested by this file.

## Included changes

- server.py.patch adds five lines after Flask app construction. With MASTER_WOK_BACKEND_EVENT_STAGING_ENABLED absent/false, it does not import or register the new integration.
- master_wok_customer_routes.py registers POST /master-wok-staging/proposal-response only after exact Railway staging project/environment/service, synthetic scope and staging database-project checks. It uses the existing verified-TLS narrow writer transport and signed proposal-response adapter.
- The route takes exactly token/decision JSON. GET does not mutate anything. It refuses oversized bodies, duplicate JSON fields, extra fields, bad signatures and foreign identities before database transport. Responses are no-store and contain no token, key or backend diagnostic text.
- Success is returned only after the transaction transport returns RECORDED or ALREADY_RECORDED. A duplicate response returns its historical receipt; it is not a statement about the order's current offer. Backend exceptions return NOT_APPLIED / HTTP 503, never a success page. Generic transport failures cannot safely distinguish a stale proposal from an outage, so the wrapper does not invent a precise conflict cause.
- Existing public accept/decline GET routes, admin actions, scheduling, notifications, checkout and payment behaviour are untouched. In particular, this patch does not fix the existing rejection-capacity discrepancy or replace insecure legacy links. Those remain separate reviewed changes.

## Scope and configuration

This preparation is intentionally incapable of enabling against the production Railway environment. Even explicit true there raises a startup error. It uses the existing synthetic staging order aliases and private test transaction, not public.orders. The supplied server.py may otherwise initialize its existing clients: any later staging deployment of the full backend must use staging-only configuration for *all* legacy clients, not merely this adapter's DSN. Do not deploy the full backend to the test service with production credentials.

In a staging checkout, place master_wok_customer_routes.py alongside server.py and make the reviewed railway-shadow modules available on PYTHONPATH. Supply a separate private random signing key (64 lowercase hex characters representing 32 bytes), stream ID and existing narrow staging writer DSN. No secret is supplied here. Tokens must be minted by the trusted offer path after the offer commits. Key storage/rotation, access-log redaction, issuer authorization and actual customer-facing confirmation UI remain required before public use.

The review flag, project context and synthetic scope gates are enforced in register_staging_routes. No route is registered when disabled. Test-only Flask==3.1.2 is pinned in railway-shadow/requirements-backend-review.txt; deployed runtime requirements and production's existing requirements.txt are unchanged.

## Source and tests

The patch is based on owner-supplied server(1).py, SHA-256 ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88. Tests check that exact source hash, normalize line endings for patch application, apply the unified patch to a temporary copy, start the full patched Flask app with external clients isolated, check default-off routing and the original health/customer paths, then exercise the enabled staging route with an injected transaction transport. The owner source itself is not duplicated into this repository.

The optional full-source test uses MASTER_WOK_REVIEW_SERVER_PATH pointing to that supplied file. Without it the test is explicitly skipped; the remaining route tests still run. The actual local review run supplies it. No live customer route, notification or database request is used by these tests. The previous deployed signed HTTP/PostgreSQL trial is complementary evidence; this Flask patch itself has not been deployed or tested against PostgreSQL.

## What remains before real customer integration

1. Adapt the reviewed transaction/outbox to a production-shaped staging order store, preserving original request, current proposal ID, reservation and immutable event in one transaction. The current synthetic transaction cannot be pointed at production rows.
2. Patch the actual admin offer command to use that transaction and return the committed proposal ID for signing. Capture order+items completion atomically and establish baseline coverage for existing/advance orders.
3. Replace the legacy customer response mutation with proposal-bound POST/confirmation behaviour and clear failure UI. Coordinate new notification links and existing/stale links; verify or retire the separate order-confirm Edge route deliberately.
4. Cover direct status writers, cross-day changes, rejection of previously confirmed orders, concurrent responses and all active submission paths before claiming complete decision history.
5. Review the concrete production SQL/handler diff separately. No production SQL writes, capture activation or live scheduling changes are included in this patch.

Validation: all 48 event-related Python tests passed in 11.067 seconds, including the optional full supplied-backend patch test (not skipped). No production files, infrastructure configuration or database rows changed.
