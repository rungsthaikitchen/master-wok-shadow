-- Prepared 11 November. Execute only after explicit activation approval and
-- successful exact-runtime/configuration verification. Not an install script.
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
DO $scope$ DECLARE n integer; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.master_wok_launch_control WHERE id=1 AND mode='LEGACY' AND revision=4 AND approved_release_id='master-wok-launch-2026-11-03') THEN
  RAISE EXCEPTION 'FOUR_RING_CONTROL_CHANGED';
 END IF;
 IF (clock_timestamp() AT TIME ZONE 'Europe/London')::time >= TIME '16:30' THEN RAISE EXCEPTION 'FOUR_RING_PRE_SERVICE_ONLY'; END IF;
 PERFORM set_config('master_wok.authoritative_writer','1',true);
 UPDATE public.orders SET confirm_token=NULL
 WHERE id IN ('4e43da45-dd9b-417b-9017-7b7881ce327a'::uuid,'51abe642-a5c0-443c-8edf-76e694a0cf5e'::uuid,'5ebd67eb-5284-4ebc-9ceb-2ed7b440fb67'::uuid,'60881019-7611-4b23-b42c-75ba1d3030ca'::uuid,'621ae691-0bad-4e4e-b5f5-6c0dc9425cc4'::uuid,'746c58b4-b5f0-4a13-99af-8501c24351dc'::uuid,'87f562f4-bb63-4894-a9ab-aa651ec342e5'::uuid,'89387d4f-c0c2-41ca-b3a2-be51e7c20a91'::uuid,'a6b948d9-7eb2-4143-aa48-23b1efcb0316'::uuid,'af4d45be-5c4e-4505-9e43-9980daad8371'::uuid,'cca29c6a-b26f-4c93-82ab-644d71513764'::uuid,'cf6ab171-d2df-4986-b8ca-b90242d62682'::uuid,'d96d14b0-c963-4833-850e-2d0919897419'::uuid)
 AND is_test IS FALSE AND capacity_scheduler='LEGACY' AND lower(status)='proposed'
 AND confirm_token IS NOT NULL AND created_at<TIMESTAMPTZ '2026-11-04 00:00:00Z'
 AND greatest(confirmed_time,proposed_time,preferred_time)<TIMESTAMPTZ '2026-11-04 00:00:00Z';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>13 THEN RAISE EXCEPTION 'HISTORICAL_LINK_SCOPE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE is_test IS NOT TRUE AND capacity_scheduler='MASTER_WOK' AND lower(coalesce(status,'')) NOT IN ('completed','cancelled','declined','rejected')) THEN RAISE EXCEPTION 'UNFINISHED_MASTER_WOK_ORDERS'; END IF;
END $scope$;
-- Run in the same transaction as the revision-checked release switch.
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

DO $switch$ DECLARE n integer; BEGIN
 UPDATE public.master_wok_launch_control SET mode='MASTER_WOK',
 approved_release_id='master-wok-four-ring-2026-11-10',revision=revision+1,updated_at=clock_timestamp()
 WHERE id=1 AND mode='LEGACY' AND revision=4 AND approved_release_id='master-wok-launch-2026-11-03';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'FOUR_RING_SWITCH_FAILED'; END IF;
END $switch$;
COMMIT;
SELECT mode,approved_release_id,revision FROM public.master_wok_launch_control WHERE id=1;
