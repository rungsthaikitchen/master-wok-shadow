# Verified staff transaction candidate — 27 October 2026

This separate versioned staging contract now connects a cryptographically verified synthetic Cloudflare staff identity through a signed service envelope to the existing booking/reservation/event transaction. No live UI, API, hosted database, availability or notification provider was changed. Defaults remain disabled and only synthetic signing-key configuration is accepted.

## Contract and trust boundary

The browser command is exactly version, commandId, orderId, expectedRevision, action and (for offer only) target. Version is 1; command and order IDs are canonical lowercase UUIDs. Actions are offer, confirm, cancel and complete. Customer acceptance/rejection and the unused mark_paid action are excluded. Targets use canonical whole-second UTC timestamps in this candidate; existing offset-preserving legacy UI requests remain a separate contract. Identity, route and service credentials cannot be supplied in the browser JSON.

After Access verification, the sender derives a stable keyed staff pseudonym from issuer/application/subject. Raw JWT, subject, email, browser cookies and Authorization are not forwarded or stored in the audit. The actor pseudonym is still sensitive pseudonymous data, not a claim of irreversible anonymisation. It depends on retaining the actor key; rotation requires a separate plan.

A separate HMAC key authenticates the envelope body containing version, issuedAt, actorId and command. Receiver verification precedes any SQL callback. Future or at-least-30-second-old envelopes fail. A retry obtains fresh Access verification and a fresh envelope while retaining command ID and content. Signed envelopes are not one-use tokens: replay is safe only because the SQL command ledger enforces idempotency. The fixed server-side route, not a browser routeId, selects the fixture transaction. No hosted key or runtime grant is installed.

## Atomic database behaviour

staff-command-candidate.sql adds only a private synthetic table and SECURITY INVOKER function. Public, anon, authenticated and service_role privileges are revoked; the existing event-writer role receives no new privilege. The fixture owner invokes it for these tests. Lock order follows existing writers: route shared advisory lock, enabled current stream row, booking row. Only generation-zero routes are supported; cutover use fails explicitly.

The order revision is the latest event sequence associated with that booking in the current stream. It therefore advances on customer responses and legacy routed booking changes too, without adding a revision column or trigger to existing booking writes. It is not the originally requested time or a reconstructed historical timestamp. The private stream currently caps events at 1000, so the indexed stream scan is bounded.

Under the same stream lock, the function first checks any saved command ID. An exact same-actor retry returns its recorded result even if later commands changed the order. Different content, revision or actor reusing that ID fails. For new commands, the expected order revision must match. The existing atomic writer records the actual new decision at transaction time, updates the booking and replaces/releases the reservation. The staff audit row references the resulting immutable event via a foreign key. Failure to insert that audit rolls everything back. Existing event JSON remains unchanged; audit-aware export/retention requires subsequent integration.

The new audit ledger and original booking command ledger serve different purposes: actor/revision attestation versus the existing action/event writer contract. No event is described as completed cooking or driving activity.

## Persistent command intent

staff-command-outbox.mjs is a local UI candidate with injected browser-style storage and no network operations. It creates and persists a UUID before returning a sendable command. A new store instance resumes exactly that pending command after reload. It refuses a second intent until a matching successful result is acknowledged. Timeout/conflict/invalid acknowledgement does not silently clear it. A later explicit new intent receives a new ID even if the proposal contents are otherwise identical. Storage errors/corruption fail closed. This does not provide a real multi-tab UI or conflict-resolution screen; those remain integration work. A replay response reports the historical command result/revision, so the UI must refresh current state before starting another action.

## Results and practical limits

All 52 Node test entries pass in Europe/London and UTC. Coverage includes lost committed response plus a simulated reload, same-ID conflicts, stale revision, repeat proposals, stale customer acceptance, customer rejection, cancellation, one-hold confirmation, forged/expired envelopes, forbidden browser identity fields and atomic rollback when audit persistence fails.

The bundled local Workers sender additionally passes nine end-to-end cases through an intercepted signed HTTP hop, real Node HMAC receiver and embedded Postgres SQL. It records exactly three staff audit rows, five total booking events and zero remaining holds after cancellation. All six synthetic service requests and one JWKS request are intercepted. No production request, notification or hosted deployment occurred. PGlite is a single connection: Promise.all does not establish true concurrent-session safety.

Run node --test *.test.mjs from this directory in each timezone. To repeat the local runtime test, set MINIFLARE_MODULE to installed Miniflare 5.20261023.0-beta and run node runtime-staff-transaction.cjs. New SQL is loaded explicitly only by these fixtures; existing hosted loaders do not apply it.

## Smallest hosted staging rollout

1. Add the candidate table/function only to the existing private synthetic staging schema, with a narrowly reviewed execution role and statement/lock timeouts. Do not grant browser or production roles access.
2. Wire the staging-only receiver to that role and fixed route, with bounded feature flag/run duration. Install staging-specific hop/actor keys privately; the current code intentionally accepts synthetic keys only. Any production credential support is a separate review.
3. Run genuine separate-session competing-offer, audit-failure, timeout/reload retry and stale-customer-response fixtures, then verify counts and clean all fixtures. Keep customer notification and booking providers stubbed.
4. Disable the trial and revoke temporary grants. Review event-reader/audit export, actor-key lifecycle, route-cutover semantics, browser conflict handling and real schema compatibility before any live integration. No additional paid infrastructure is needed for the intended use of existing staging services, but resource consumption has not been measured.

Standing approval covers committing this candidate. It does not override the prohibition on production Supabase writes or authorise a change to live scheduling behaviour.
