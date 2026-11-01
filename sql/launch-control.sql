-- Review only: default stays LEGACY. Never populate approval from client input.
CREATE TABLE public.master_wok_launch_control (
 id integer PRIMARY KEY CHECK(id=1),
 mode text NOT NULL DEFAULT 'LEGACY' CHECK(mode IN ('LEGACY','DRAINING','MASTER_WOK')),
 approved_release_id text,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(mode<>'MASTER_WOK' OR approved_release_id IS NOT NULL)
);
INSERT INTO public.master_wok_launch_control(id) VALUES(1);
ALTER TABLE public.master_wok_launch_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_launch_control FROM PUBLIC,anon,authenticated,service_role;

-- Release/drain operator protocol, only after explicit release approval:
-- BEGIN;
-- SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
-- UPDATE public.master_wok_launch_control SET mode='DRAINING',revision=revision+1,
--   updated_at=now() WHERE id=1 AND revision=:expected_revision RETURNING *;
-- Require exactly one row; COMMIT. All previous writer transactions have ended.
-- New writes recheck the durable mode inside the lock and refuse while draining.
-- Restore legacy privileges/routing ONLY after verifying the drain and handling
-- unknown attempts. Do not drop orders, receipts, plans or compatibility columns.
