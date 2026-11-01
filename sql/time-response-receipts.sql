-- Review only: customer response receipts make retries stable and prevent an
-- old link from accepting a later proposal. Apply only in approved deployment.
CREATE TABLE public.master_wok_time_responses (
 token text PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.orders(id),
 decision text NOT NULL CHECK(decision IN ('customer_accept','customer_decline')),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_wok_time_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_time_responses FROM PUBLIC,anon,authenticated;
