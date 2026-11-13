-- Apply to staging first; production requires owner approval.
BEGIN;
CREATE TABLE public.order_amendments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 idempotency_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL,
 actor text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 before_details jsonb NOT NULL,
 after_details jsonb NOT NULL,
 response jsonb NOT NULL
);
CREATE INDEX order_amendments_order_time_idx ON public.order_amendments(order_id,occurred_at);
ALTER TABLE public.order_amendments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_amendments FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='master_wok_writer') THEN
  GRANT SELECT,INSERT ON public.order_amendments TO master_wok_writer;
 END IF;
END $$;
COMMIT;
