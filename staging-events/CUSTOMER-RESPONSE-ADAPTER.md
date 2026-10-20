# Customer response adapter preparation — 20 October 2026

`event_customer_response_staging.py` is an unwired, default-off adapter for private synthetic staging only. It is not a patch to server.py, an Edge Function, a public route or customer email content. It has no network client, listener, environment lookup, automatic deployment or notification sender. Production remains unchanged.

## Supplied backend findings

The owner supplied server(1).py as the current backend. Its SHA-256 is ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88, identical to the earlier server.py upload. This closes the source-supply gap for preparing the backend diff, although independent matching to Railway's deployed commit remains unavailable through GitHub.

The supplied backend implements time_accept/update_order_time_accept and time_decline/update_order_time_decline. Acceptance copies the currently saved proposed_time into confirmed_time and writes customer_accepted_time. Decline writes customer_declined_time and retains proposed_time. find_order first selects by order ID; it does not validate a proposal-specific token on that successful path. The helpers swallow lookup/update failures, so a route can display success despite a failed database write. These are concrete discrepancies to address in staging, not changes applied to production.

The previously supplied notifications.py generates Railway /orders/<id>/time/accept and /decline links. This supports the Railway response path but does not prove the deployed notifications.py revision. The website repository still contains a separate order-confirm.html calling Supabase order-confirm; that function's code remains unavailable via the connector and the owner sees an empty editor. Leave it untouched; do not fabricate replacement code or declare it inactive without verifying actual call paths.

## Adapter contract

- Enablement must be literal true and the project must be the known staging project. Only synthetic order aliases are accepted. Disabled calls return before key parsing or transport.
- A trusted staging caller issues an HMAC-SHA256 token bound to scope, stream ID, order alias and proposal event ID. Use a separate random key of at least 32 bytes when integrating; tests use an explicitly synthetic key. No production secret was created or requested.
- Responses require POST with exactly token/decision fields. GET is refused, so visiting a link alone is not a mutation in this adapter. A future UI should present a confirmation form before POST; do not transplant this into the existing GET routes without reviewing the customer journey.
- Signature comparison is constant-time. Tampering, foreign streams, extra claims and noncanonical token encodings fail before transport. Tokens contain pseudonymous identifiers only; URLs/tokens must not enter application logs or monitoring output.
- The signing key establishes bearer-token integrity, not proof of the customer's identity. The trusted issuer must authorize access and bind the token to an actual committed offer. Production issuer, key storage/rotation, token transport and customer authorization remain integration requirements.
- The proposal ID is sent to the existing staging handle transaction. Its current-proposal guard is authoritative: signing does not make an old offer current. Reservation update, immutable response event and command receipt remain atomic at the source.
- Request IDs are deterministic per token and decision. Matching retries are idempotent; opposite answers compete as separate commands. A stale/conflicting command cannot alter the current reservation. A repeated historical successful response may return its original receipt; this must not be presented as accepting a later proposal.
- No token expiry or automatic reservation expiry is invented. Replacement/rejection/cancellation/terminal-state checks are source responsibilities. Key rotation can invalidate tokens but does not itself release capacity.
- Exceptions propagate to the caller. The future HTTP wrapper must return failure/409/appropriate validation status and must not display success after an exception. No raw backend exception, token or key should reach customer responses.

## Exact future integration boundary

1. In staging, issue a token only from a successfully committed offer and its durable offer ID. Do not derive proposal identity from a time string or original order creation time.
2. Replace the supplied backend's find_order -> REST PATCH response path with one authorized transaction command that validates this offer identity and updates state/outbox together. Keep notifications after the transaction; do not await Master Wok calculations in the request path.
3. Preserve the existing public routes until the reviewed replacement form/POST path and notification-link migration are ready. Stale emailed links must fail clearly; never silently upgrade them to the latest offer.
4. Verify current notifications and the legacy order-confirm Edge route before enabling any replacement. Update all active callers or mark coverage incomplete. Do not enable automatic booking decisions.

## Test evidence

The three new tests use the real local synthetic transaction source and shared Node replay validation. Cases cover default-off/no transport, GET rejection, tampered token, extra fields, wrong project/stream/key, repeat offers, stale acceptance rollback, acceptance retaining one reservation, opposing response rejection, rejection releasing capacity, duplicate rejection and propagated backend failure. They do not exercise a deployed HTTP server or claim Postgres concurrency evidence beyond the earlier dedicated staging handler tests.

Final validation: all 40 event-related Python tests passed in 10.756 seconds. The initial broader run found psycopg absent from the local environment; installing the existing pinned psycopg/psycopg-binary 3.3.6 requirements resolved that environment issue. No dependency versions changed.
