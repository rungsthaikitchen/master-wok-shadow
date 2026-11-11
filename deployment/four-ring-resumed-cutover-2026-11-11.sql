BEGIN; SET LOCAL lock_timeout='10s'; SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824)); DO $r$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.master_wok_launch_control WHERE id=1 AND mode='LEGACY' AND revision=7 AND approved_release_id='master-wok-four-ring-2026-11-10') THEN RAISE EXCEPTION 'RESUME_CONTROL_CHANGED'; END IF; IF EXISTS(SELECT 1 FROM public.orders WHERE is_test IS NOT TRUE AND capacity_scheduler='MASTER_WOK' AND lower(coalesce(status,'')) NOT IN ('completed','cancelled','declined','rejected')) THEN RAISE EXCEPTION 'UNFINISHED_MASTER_WOK_ORDERS'; END IF; END $r$; -- Run in the same transaction as the revision-checked release switch.
-- Use the pre-service window. Any current or future commitments require
-- a separate migration rehearsal before enabling the delivery release.
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));

DO $guard$
DECLARE
  local_now timestamp := clock_timestamp() AT TIME ZONE 'Europe/London';
BEGIN
  IF local_now::time >= TIME '16:30' THEN
    RAISE EXCEPTION 'DELIVERY_CUTOVER_REQUIRES_PRE_SERVICE_WINDOW';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE is_test IS NOT TRUE
      AND lower(status) NOT IN ('cancelled', 'declined', 'rejected')
      AND (
        (lower(status) = 'proposed' AND NOT (
          capacity_scheduler IS NOT DISTINCT FROM 'LEGACY'
          AND confirm_token IS NULL
          AND created_at IS NOT NULL
          AND created_at < TIMESTAMPTZ '2026-11-04 00:00:00Z'
          AND greatest(confirmed_time, proposed_time, preferred_time) IS NOT NULL
          AND greatest(confirmed_time, proposed_time, preferred_time) < TIMESTAMPTZ '2026-11-04 00:00:00Z'
        ))
        OR greatest(confirmed_time, proposed_time, preferred_time)
           >= (local_now::date::timestamp AT TIME ZONE 'Europe/London')
        OR (lower(status) <> 'completed' AND
            coalesce(confirmed_time, proposed_time, preferred_time) IS NULL
            AND NOT (
              capacity_scheduler IS NOT DISTINCT FROM 'LEGACY'
              AND created_at IS NOT NULL
              AND created_at < TIMESTAMPTZ '2026-11-04 00:00:00Z'
            ))
      )
  ) THEN
    RAISE EXCEPTION 'DELIVERY_CUTOVER_REQUIRES_COMMITMENT_MIGRATION';
  END IF;
END;
$guard$;
 DO $s$ DECLARE n integer; BEGIN UPDATE public.master_wok_launch_control SET mode='MASTER_WOK',revision=revision+1,updated_at=clock_timestamp() WHERE id=1 AND mode='LEGACY' AND revision=7 AND approved_release_id='master-wok-four-ring-2026-11-10'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'RESUME_SWITCH_FAILED'; END IF; END $s$; COMMIT; SELECT mode,revision,approved_release_id FROM public.master_wok_launch_control WHERE id=1;