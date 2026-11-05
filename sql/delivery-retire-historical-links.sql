-- Operator step for this release. Run in the same transaction as the
-- cutover guard and revision-checked switch. Keep order history intact.
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));

DO $reconcile$
DECLARE
  retired_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.master_wok_launch_control
    WHERE id = 1 AND mode = 'MASTER_WOK' AND revision = 2
      AND approved_release_id = 'master-wok-launch-2026-11-03'
  ) THEN
    RAISE EXCEPTION 'DELIVERY_RECONCILIATION_RELEASE_CHANGED';
  END IF;

  PERFORM set_config('master_wok.authoritative_writer', '1', true);

  UPDATE public.orders SET confirm_token = NULL
  WHERE is_test IS FALSE AND capacity_scheduler = 'LEGACY'
    AND lower(status) = 'proposed' AND confirm_token IS NOT NULL
    AND created_at < TIMESTAMPTZ '2026-11-04 00:00:00Z'
    AND proposed_time < TIMESTAMPTZ '2026-11-04 00:00:00Z'
    AND greatest(confirmed_time, proposed_time, preferred_time) < TIMESTAMPTZ '2026-11-04 00:00:00Z';

  GET DIAGNOSTICS retired_count = ROW_COUNT;
  IF retired_count <> 13 THEN
    RAISE EXCEPTION 'DELIVERY_RECONCILIATION_COUNT_CHANGED';
  END IF;
END;
$reconcile$;
