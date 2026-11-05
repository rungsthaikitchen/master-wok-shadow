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
        lower(status) = 'proposed'
        OR greatest(confirmed_time, proposed_time, preferred_time)
           >= (local_now::date::timestamp AT TIME ZONE 'Europe/London')
        OR (lower(status) <> 'completed' AND
            coalesce(confirmed_time, proposed_time, preferred_time) IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'DELIVERY_CUTOVER_REQUIRES_COMMITMENT_MIGRATION';
  END IF;
END;
$guard$;
