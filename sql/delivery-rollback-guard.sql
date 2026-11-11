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

  -- Legacy does not model a manually extended cooking/holding window.
  -- Retained started work still matters after cancellation or test tagging.
  -- Do not restore Legacy until every such job/promise has elapsed.
  IF EXISTS (
    SELECT 1
    FROM public.master_wok_service_plans AS service
    CROSS JOIN LATERAL jsonb_array_elements(
      coalesce(service.plan #> '{wok,jobs}', '[]'::jsonb) ||
      coalesce(service.plan #> '{fryer,jobs}', '[]'::jsonb) ||
      coalesce(service.plan #> '{auxiliary,jobs}', '[]'::jsonb)
    ) AS job
    WHERE EXISTS (
      SELECT 1 FROM jsonb_each(coalesce(service.plan->'holdExceptions', '{}'::jsonb)) AS exception
      WHERE job->'orderIds' ? exception.key
    ) AND (
      job->>'finish' IS NULL OR
      ((service.service_date::timestamp + greatest(
        coalesce((job->>'readyMinute')::integer, (job->>'finish')::integer),
        (job->>'finish')::integer
      ) * interval '1 minute') AT TIME ZONE 'Europe/London') > checked_at
    )
  ) THEN
    RAISE EXCEPTION 'OUTSTANDING_HOLD_EXCEPTION_WORK';
  END IF;

  -- Also block on deliveries without a driver plan and unresolved proposals.
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE order_type = 'delivery' AND is_test IS NOT TRUE
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
        OR greatest(confirmed_time, proposed_time, preferred_time) >= checked_at
        OR (lower(status) <> 'completed' AND
            coalesce(confirmed_time, proposed_time, preferred_time) IS NULL
            AND NOT (
              capacity_scheduler IS NOT DISTINCT FROM 'LEGACY'
              AND created_at IS NOT NULL
              AND created_at < TIMESTAMPTZ '2026-11-04 00:00:00Z'
            ))
      )
  ) THEN
    RAISE EXCEPTION 'OUTSTANDING_DELIVERY_ORDERS';
  END IF;
  -- The compatible Legacy routes cannot finalize Master Wok-owned orders.
  -- Keep the authoritative lifecycle available until all such orders finish.
  -- Pause new orders in Admin first; DRAINING is only the final switch fence.
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE capacity_scheduler = 'MASTER_WOK' AND is_test IS NOT TRUE
      AND coalesce(lower(status), '') NOT IN ('completed', 'cancelled', 'declined', 'rejected')
  ) THEN
    RAISE EXCEPTION 'OUTSTANDING_MASTER_WOK_ORDERS';
  END IF;
END;
$guard$;
