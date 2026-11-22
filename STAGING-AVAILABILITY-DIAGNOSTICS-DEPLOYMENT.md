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

## Required before any staging deployment

1. **VERIFIED (22 November):** all 56 deployed staging version 92 JavaScript modules match the GitHub base branch `review/availability-readiness-2026-11-17` after removing the bundle wrapper and outer whitespace. The embedded `checkout-catalog.json` matches the GitHub JSON semantically (including source metadata, items, modifiers and extras). The embedded staging release certificate is intentionally different from the GitHub DRAFT production certificate. Full build-process reproducibility and new staging source digest remain unverified.
2. Apply only the diagnostics patch to the correct staging baseline. Verify no accidental changes to assessment, release fences, payment, booking, notification, or delivery behavior.
3. Generate the new source digest using the existing certified build procedure. The changed source must not retain the previous source digest.
4. Create a **staging-only** certificate for that new digest, retaining the candidate status, private schema, model, project, approved fixture policy, and the existing check semantics. Do not promote pending checks to PASS without evidence.
5. Run complete existing engine and staging integration tests, plus `node --test tests/master-wok-availability-diagnostics.test.cjs`; inspect the resulting bundle to confirm production schema has no diagnostics callback.
6. Capture rollback artifact and current function configuration/version; schedule a quiet staging test window.
7. Obtain explicit operator approval before deploying to the staging Edge Function. Do not merge this draft PR or modify production.
8. After approved staging deployment, verify version, source digest and certificate; run a synthetic availability failure in private staging only and inspect sanitized stage logs. Verify ordinary availability and checkout are unchanged. Roll back if any regression.

## Safety properties

Diagnostic events contain only fixed fields: `operation`, `stage`, `category`. No exception messages, SQL, addresses, basket items, or customer identifiers. The logger must never change the HTTP response. The diagnostic callback is only attached when `schema === 'master_wok_rehearsal'`.

**No deployment authorization is implied by this document.**
