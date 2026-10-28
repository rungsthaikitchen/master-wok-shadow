# Approved preview trial — startup refusal and shutdown

Owner explicitly approved the temporary public endpoint on 28 October.
Railway domain ID `557881ef-3c4c-49c1-9739-fb12b185b7d1` was created on the
existing staging service, targeting 8080, and subsequently deleted after refusal.
No public domain is required for the private diagnostic.

Temporary ACL migration `synthetic_preview_browser_trial_activation_28_oct`
enabled only the fresh fixed fixture. First deadline 06:06:08 UTC elapsed before
Railway deployment `548312b2-900f-4c02-a9af-a83fa35b62dd` could start; it was later
removed by the platform. A separately announced fresh window ended 06:21:30 UTC.
Deployment `f0bd2762-7c0e-47ca-81d3-df1c469b4067` reached startup at about 06:14:22,
then logged REFUSED / PREVIEW_RECEIVER_FAILED and was marked CRASHED. No more
activation attempts were made after that refusal.

Pages trial commits `6ccb63138062ad4ebe55e0e067111e564ecfd2cf` and
`7e93c671e69e845fd55b017770ccb808694d575b` deployed, but no hosted browser actions
were requested or verified. Cleanup commit
`402957c61584c11806171b04b2384e3544de025f` restores the exact disabled preview tree.
Earlier hashed trial deployments expire independently; the receiver is stopped
and public domain removed, so they cannot reach the database.

Cleanup migration `synthetic_preview_browser_trial_cleanup_28_oct` was applied.
Independent SQL verification: enabledStreams 0, activeHolds 0, fixtureEvents 2,
auditRows 0, readerBooking false, staffExecution false. Receiver enable flag was
set false, without launching another trial. No production changes/messages.

The hosted deployment metadata reported commit `3080242...` even though the
service configuration remains pinned to `6843a73...`. These commits differ only
by the preparation checkpoint document, so this does not explain the failure;
record both rather than claiming an exact runtime SHA from configuration alone.

## Diagnostic correction

The generic startup exception handler concealed the reason. The correction emits
only an explicit allowlist of configuration/budget/role reason codes or selected
SQLSTATE identifiers, never raw exception text, credentials, DSNs or identities.

`python railway-shadow/preview_browser_receiver.py --diagnose` requires the trial
flag false, validates the pinned configuration using a diagnostic-only deadline,
opens no HTTP listener, consumes/resets no trial budget and opens the existing
budget SQLite file read-only if present. It then performs a read-only staging
role/fixture check. The fixture can remain disabled and grants revoked.

18 Python tests pass in the default UK run and UTC, covering safe reason codes
and proof that diagnostics do not alter the durable budget or enable/listen.
The local generated preview package was restored to its default-disabled build.
Do not delete/reset a started budget after diagnosis. If startup consumed its
one-start allowance, a future trial needs a new reviewed fixture/journal version.

## Identified cause and corrected candidate

Private diagnostic deployment `e71f5284-79ad-4b68-827c-b5348242d3ed` completed
successfully: configurationVerified/roleVerified true; fixture disabled with two
events; budget showed started 1 and preflight 1. This confirms valid key format,
staging reader connectivity and that the start allowance was consumed. It does
not expose the key or prove that the hop key matches Cloudflare's copy.

An independent administrator privilege query found the missing prerequisite:
the reader had no SELECT privilege on command_routes, including each of id,
current_stream and generation. Its existing RLS SELECT policy was present.
Startup requires those columns to join the fixed route and verify generation.
The previous local role fixture had granted whole-table SELECT, masking this
hosted discrepancy.

The corrected version-2 activation grants only those three reader columns and
cleanup revokes them. The regression now explicitly revokes the broad baseline
reader grant before activation, executes the exact startup route/audit query as
the reader and verifies that unrelated scope-column access is still denied.
Cleanup verifies the new column privilege is removed. Full Node suite: 83 passed
in UK time and UTC; Python suite: 18 passed in each timezone.

Version 1's journal and events are retained unchanged. The next candidate uses
new fixed UUIDs in `fixtures/preview-browser-28-oct-v2.json`, separate version-2
seed/activation/cleanup SQL, and `/data/preview-browser-28-oct-v2/budget.sqlite3`.
Receiver and default-disabled Pages build now bind to that new fixture. This is
a new trial candidate, not a reset or retry of a spent journal.
