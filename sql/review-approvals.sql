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
