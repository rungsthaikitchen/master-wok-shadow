# Staging-only availability diagnostics: deployment gate

Status: **PREPARATION ONLY — NOT APPROVED OR DEPLOYED** (22 November 2026).

## Verified deployed staging baseline

- Supabase project: `hvrqgufqjslvgiohgkvu`
- Edge Function: `master-wok-booking`, observed version **92**
- Certificate status: `CANDIDATE_FOR_STAGING`
- Release ID: `master-wok-delivery-2026-11-04`
- Schema: `master_wok_rehearsal`
- Model: `combined-kitchen-four-ring-staging-v1`
- Certificate source digest: `81bab047c8d65da1e683ae9fa6ecee3d5ab16b998e6f8be9d7ddb0614e65a0db`
- Existing deployment does **not** include `onAvailabilityFailure` or the failure-stage callback.
- Current branch's checked-in `master-wok-release-candidate.json` is a **DRAFT production certificate**; it is NOT the staging certificate and MUST NOT be deployed as-is.

## Newly identified credential-handling blocker (22 November)

Inspection of the deployed staging Edge Function version 92 bootstrap wrapper found a `privateStagingConfiguration` object with **embedded staging secrets**. Do not copy this object or its values into a new bundle, GitHub source, logs, test fixtures, or deployment documentation. The deployed function's project-URL guard is not a substitute for keeping secrets outside source code. Confirm credential scope, rotate affected secrets using an approved process, and verify a replacement bundle reads secrets from protected environment configuration. Review the impact of rotation on staging clients and downstream integrations before applying changes. The full source-reconciliation result does not certify the bootstrap wrapper or credential hygiene.

## Required before any staging deployment

1. **VERIFIED (22 November):** all 56 deployed staging version 92 JavaScript modules match the GitHub base branch `review/availability-readiness-2026-11-17` after removing the bundle wrapper and outer whitespace. The embedded `checkout-catalog.json` matches the GitHub JSON semantically (including source metadata, items, modifiers and extras). The embedded staging release certificate is intentionally different from the GitHub DRAFT production certificate. Full build-process reproducibility and new staging source digest remain unverified.
2. Apply only the diagnostics patch and secure staging bootstrap to the correct staging baseline. The new `staging-secure-edge-entry.js` is a source template, **not** a deployable Edge Function; it requires verified packaging and a staging-only certificate. Verify no accidental changes to assessment, release fences, payment, booking, notification, or delivery behavior.
3. Recover the exact original bundle-generation procedure and source digest algorithm from verified build artifacts or operator records; these remain **unverified** and must not be guessed. Generate the new source digest using the recovered and validated procedure. **Do not embed private staging credentials in the generated source.** The changed source must not retain the previous source digest.
4. Create a **staging-only** certificate for that new digest, retaining the candidate status, private schema, model, project, approved fixture policy, and the existing check semantics. Do not promote pending checks to PASS without evidence.
5. Run complete existing engine and staging integration tests, plus `node --test tests/master-wok-availability-diagnostics.test.cjs tests/staging-secure-bootstrap-config.test.cjs tests/staging-secure-edge-entry.test.cjs tests/staging-secure-bundle.test.cjs`. Once the exact staging artifact is generated, run `node scripts/assert-secure-staging-bundle.cjs <path-to-generated-index.ts>` and perform an independent review for embedded credentials; the heuristic checker alone is insufficient. Inspect the resulting bundle to confirm production schema has no diagnostics callback.
6. Capture rollback artifact and current function configuration/version; schedule a quiet staging test window.
7. Obtain explicit operator approval before deploying to the staging Edge Function. Do not merge this draft PR or modify production.
8. After approved staging deployment, verify version, source digest and certificate; run a synthetic availability failure in private staging only and inspect sanitized stage logs. Verify ordinary availability and checkout are unchanged. Roll back if any regression.

## Safety properties

Diagnostic events contain only fixed fields: `operation`, `stage`, `category`. No exception messages, SQL, addresses, basket items, or customer identifiers. The logger must never change the HTTP response. The diagnostic callback is only attached when `schema === 'master_wok_rehearsal'`.

**No deployment authorization is implied by this document.**
