# Hosted preparation checkpoint — 27 October 2026

Reviewed runtime commit: `6843a73c7c8427f0b346fc5613eb0746f58736cb`.
Railway disabled deployment: `7fea18e5-d5c3-421b-84ed-44b451dd3594`, SUCCESS.
Service: `012e5ef6-6225-4ab3-95f5-894583db7e83`, environment
`c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279`, project
`7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8`.

The owner's hop key was present as a staged secret and preserved without reading
or replacing its value. Actor key remains on Cloudflare only. The receiver source
is pinned to the reviewed commit, start command is
`python railway-shadow/preview_browser_receiver.py`, restart policy NEVER,
PORT 8080. All 22 named Master Wok enable flags were explicitly set false for
the preparation deployment. There are no remaining staged environment changes.
Railway reported deployment SUCCESS; runtime log reads returned no entries, so
no startup/source-request counters are claimed as directly witnessed in logs.

Staging Supabase only (`hvrqgufqjslvgiohgkvu`): the new fixed fixture was seeded
transactionally using `preview-browser-fixture.sql`, leaving it DISABLED. A
separate verification returned eventCount 2, auditRows 0, enabledStreams 0,
activeHolds 0; reader audit/booking privileges and staff-command execution remain
false. The four relevant tables have RLS enabled; staff/routed functions are
SECURITY INVOKER. The temporary activation SQL has NOT been applied.

No production Supabase requests or writes, live scheduling changes, customer
messages, trial activation or new persistent compute/storage resources were
performed. The current Pages preview remains the default-disabled deployment.

## Blocked boundary

Automatic approval review rejected `generate_domain` for this staging service
on port 8080: it would introduce persistent public access, which was not covered
by the prior staging-deploy authorization. No domain was created; a subsequent
domain listing confirmed both service and custom domain lists empty. No attempt
was made to bypass the rejection with another tool or route.

The exact next requested approval is for a temporary generated HTTPS domain on
this existing staging service, targeting 8080, to let the already Access-protected
Pages preview reach the receiver. The receiver accepts only fixed-path,
HMAC-signed requests for one synthetic fixture during a maximum ten-minute window;
direct unsigned requests cannot reach the database. Domain routing itself does
not auto-expire: remove it explicitly after the trial. The receiver and enabled
Pages build both have independent hard expiry, and all flags/grants must be
disabled/revoked after evidence collection. Do not activate until approval arrives.

After approval: generate and verify the domain against service metadata, build
the exact endpoint into the preview, coordinate a fresh deadline, apply temporary
fixture ACLs, enable the receiver and preview, collect evidence, then disable the
routes, revoke ACLs and remove the temporary domain. Do not reset the budget or
reuse an already spent fixture/journal.
