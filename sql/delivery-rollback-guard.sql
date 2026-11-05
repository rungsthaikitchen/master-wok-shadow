-- Run inside the same transaction as the guarded mode change. Keep the
-- transaction open through the mode update so no booking can race this check.
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));

DO $guard$
DECLARE
  checked_at timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.master_wok_launch_control WHERE id = 1 AND mode = 'DRAINING'
  ) THEN
    RAISE EXCEPTION 'DELIVERY_ROLLBACK_REQUIRES_DRAIN';
  END IF;

  -- Include retained trips whose orders have already been cancelled or tested.
  IF EXISTS (
    SELECT 1
    FROM public.master_wok_service_plans AS service
    CROSS JOIN LATERAL jsonb_array_elements(service.plan #> '{delivery,trips}') AS trip
    WHERE trip->>'finish' IS NULL OR ((service.service_date::timestamp + (trip->>'finish')::integer * interval '1 minute')
      AT TIME ZONE 'Europe/London') > checked_at
  ) THEN
    RAISE EXCEPTION 'OUTSTANDING_DRIVER_TRIPS';
  END IF;

  -- Also block on deliveries without a driver plan and unresolved proposals.
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE order_type = 'delivery' AND is_test IS NOT TRUE
      AND lower(status) NOT IN ('cancelled', 'declined', 'rejected')
      AND (
        lower(status) = 'proposed'
        OR greatest(confirmed_time, proposed_time, preferred_time) >= checked_at
        OR (lower(status) <> 'completed' AND
            coalesce(confirmed_time, proposed_time, preferred_time) IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'OUTSTANDING_DELIVERY_ORDERS';
  END IF;
END;
$guard$;
