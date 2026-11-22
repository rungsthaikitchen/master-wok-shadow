# Staging Edge Function bootstrap — security requirements

The deployed staging `master-wok-booking` v92 bootstrap wrapper includes an inline `privateStagingConfiguration` containing sensitive values. **Do not copy those values into this repository, CI logs, documentation, or replacement bundles.** The repository's 56 JavaScript modules and checkout catalogue have been reconciled with v92, but the bootstrap wrapper and release certificate are deployment-specific.

## Safe replacement bootstrap design

1. Keep the project-specific staging certificate in a staging-only build input, never use the checked-in DRAFT production certificate unchanged. Verify project reference, schema, delivery project, model, release ID, and freshly calculated source digest.
2. Resolve `MASTER_WOK_RELEASE_ID`, `MASTER_WOK_BOOKING_SECRET`, `MASTER_WOK_NOTIFICATION_SECRET`, `MASTER_WOK_DELIVERY_PROJECT_REF`, `MASTER_WOK_DELIVERY_PUBLIC_KEY`, `MASTER_WOK_PAYMENTS`, and `MASTER_WOK_REVIEW_APPROVALS` from the deployed function's protected environment variables. Do not use inline fallback credentials. Resolve `SUPABASE_URL` and `SUPABASE_DB_URL` from the environment as before.
3. Preserve the existing deployment runtime's distinct-secret validation, staging schema isolation, project-reference checks, and delivery-project allowlist. Do not change public API response shapes or diagnostic output beyond fixed stage/category metadata.
4. If required environment values are absent or invalid, fail closed with the existing `RELEASE_NOT_CERTIFIED_OR_CONFIGURED` 503 response. Do not log secret values or raw exceptions.
5. Before rotating any credential, identify every staging caller, dependent notification flow, and shared integration that relies on it. Coordinate rotation with an approved maintenance plan; a bundle edit alone does not revoke credentials already embedded in v92.
6. Run static checks that the generated Edge Function contains no embedded staging secret literals, no `privateStagingConfiguration` object, and no sensitive-value diagnostic logging. Validate this on the final generated artifact, not just the source template.
7. Run existing regression tests, confirm release certificate and digest against the exact generated artifact, and perform a staging-only smoke test after separate deployment approval.

## Current gate

**Design documented; not implemented or deployed.** Build tooling and the exact certificate/source-digest derivation still need to be recovered and verified. Do not deploy PR #28 as-is. Production must remain unchanged.
