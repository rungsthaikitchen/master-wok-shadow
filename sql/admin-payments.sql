-- Apply to staging first. Production requires explicit owner approval.
-- The tables deliberately do not backfill or change any existing order.
BEGIN;
CREATE TABLE public.order_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
 capture_idempotency_key uuid NOT NULL UNIQUE,
 bill_amount numeric(10,2) NOT NULL CHECK(bill_amount>=0),
 bill_method text NOT NULL CHECK(bill_method IN ('cash','card','bank_transfer')),
 tip_amount numeric(10,2) NOT NULL CHECK(tip_amount>=0),
 tip_method text CHECK(tip_method IN ('cash','card','bank_transfer')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by text NOT NULL,
 previously_marked_paid boolean NOT NULL,
 CHECK((tip_amount=0 AND tip_method IS NULL) OR (tip_amount>0 AND tip_method IS NOT NULL))
);
CREATE TABLE public.order_payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 payment_id uuid NOT NULL REFERENCES public.order_payments(id) ON DELETE RESTRICT,
 event_idempotency_key uuid NOT NULL UNIQUE,
 event_type text NOT NULL CHECK(event_type='recorded'),
 new_details jsonb NOT NULL,
 actor text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_fingerprint text NOT NULL,
 response jsonb NOT NULL
);
CREATE INDEX order_payment_events_order_time_idx ON public.order_payment_events(order_id,occurred_at);
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payments,public.order_payment_events FROM PUBLIC,anon,authenticated,service_role;
-- Direct authoritative SQL writer only. No REST/RPC or permissive policies.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='master_wok_writer') THEN
  GRANT SELECT,INSERT ON public.order_payments,public.order_payment_events TO master_wok_writer;
 END IF;
END $$;
COMMIT;
