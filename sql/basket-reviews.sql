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
