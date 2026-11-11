BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.master_wok_launch_control WHERE id=1 AND mode='LEGACY' AND revision=4) THEN RAISE EXCEPTION 'PRODUCTION_INSTALL_CONTROL_CHANGED'; END IF;
 IF to_regclass('public.master_wok_basket_reviews') IS NOT NULL OR to_regclass('public.master_wok_review_approvals') IS NOT NULL THEN RAISE EXCEPTION 'PRODUCTION_INSTALL_TABLE_ALREADY_EXISTS'; END IF;
END $guard$;
-- Draft migration. Deploy only with the review API and Admin integration.
-- A review stores a request and never reserves kitchen or delivery capacity.
CREATE TABLE public.master_wok_basket_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','contacted','resolved','closed')),
 customer_name text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 200),
 customer_phone text NOT NULL CHECK (length(customer_phone) BETWEEN 7 AND 40),
 order_type text NOT NULL CHECK (order_type IN ('collection','delivery')),
 preferred_time timestamptz NOT NULL,
 delivery_address text,
 CHECK ((order_type='collection' AND delivery_address IS NULL) OR
  (order_type='delivery' AND delivery_address IS NOT NULL AND length(delivery_address) BETWEEN 5 AND 1000)),
 basket jsonb NOT NULL CHECK (jsonb_typeof(basket)='array' AND jsonb_array_length(basket) BETWEEN 1 AND 200),
 assessment jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(assessment)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_wok_basket_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_basket_reviews FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX master_wok_basket_reviews_pending
 ON public.master_wok_basket_reviews(created_at)
 WHERE status IN ('pending','contacted');

-- Prepared only. Apply to staging first; production requires separate approval.
-- Run as the private writer owner. No browser role may read grants or contacts.
ALTER TABLE public.master_wok_basket_reviews
 DROP CONSTRAINT master_wok_basket_reviews_status_check;
ALTER TABLE public.master_wok_basket_reviews ADD CONSTRAINT master_wok_basket_reviews_status_check
 CHECK (status IN ('pending','contacted','approved','resolved','closed'));
CREATE TABLE public.master_wok_review_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 review_id uuid NOT NULL UNIQUE REFERENCES public.master_wok_basket_reviews(id),
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 agreed_time timestamptz NOT NULL,
 max_hold_minutes integer NOT NULL CHECK (max_hold_minutes BETWEEN 20 AND 330),
 reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 1000),
 staff_actor text NOT NULL CHECK (length(staff_actor) BETWEEN 1 AND 320),
 customer_discussed boolean NOT NULL CHECK (customer_discussed),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 order_id uuid REFERENCES public.orders(id),
 consumed_at timestamptz,
 audit_history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(audit_history)='array'),
 CHECK (expires_at>created_at),
 CHECK ((order_id IS NULL)=(consumed_at IS NULL))
);
ALTER TABLE public.master_wok_review_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_review_approvals FROM PUBLIC,anon,authenticated,service_role;

DO $verify$ DECLARE t text; r text; p text; BEGIN
 FOREACH t IN ARRAY ARRAY['master_wok_basket_reviews','master_wok_review_approvals'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN RAISE EXCEPTION 'REVIEW_TABLE_RLS_NOT_ENABLED'; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(r,format('public.%I',t),p) THEN RAISE EXCEPTION 'REVIEW_TABLE_ROLE_ACCESS: % % %',t,r,p; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.master_wok_launch_control WHERE id=1 AND mode='LEGACY' AND revision=4) THEN RAISE EXCEPTION 'PRODUCTION_INSTALL_CONTROL_CHANGED'; END IF;
END $verify$;
COMMIT;
SELECT jsonb_build_object('status','PASS_INSTALLED_PRIVATE_REVIEWS_DISABLED','mode',mode,'revision',revision,'reviews',to_regclass('public.master_wok_basket_reviews')::text,'approvals',to_regclass('public.master_wok_review_approvals')::text) AS installation FROM public.master_wok_launch_control WHERE id=1;