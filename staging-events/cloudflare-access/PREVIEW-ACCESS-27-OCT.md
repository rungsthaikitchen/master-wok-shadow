# Preview Access configuration — 27 October 2026

The owner supplied the preview application's public audience identifier. The
`preview-access-profile.mjs` module pins it to the existing team domain and exact
branch preview origin. Caller options cannot replace those identifiers. The
factory defaults off and has no data adapter, booking transport or credentials.

Screenshots show the Pages wildcard preview application and one Allow policy
including the owner's email. The browser screenshot shows the default-disabled
preview with all actions disabled. It does not by itself prove that a fresh
unauthenticated session was challenged, or that the application's assertion was
verified inside a Pages Function.

The new tests use locally signed synthetic JWTs with an intercepted JWKS fetch.
They verify default-off behaviour, valid preview binding, rejection of the
production audience, another issuer and another hostname, and inability to
override pinned configuration. They do not attest to a real Cloudflare session.

Both deployed preview API bundles remain unchanged and disabled. The existing
synthetic browser adapter is unchanged. No production or staging database writes,
notifications, Railway changes or website deployment are part of this change.

Next: verify real preview assertion handling through a bounded data-free check,
then prepare a separately scoped staging data adapter and fresh test fixtures.
Do not re-enable the spent hosted trial or merge the isolated preview tree into
the production website branch.
