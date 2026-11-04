-- Review-only production DDL. Saved on the booking connection before COMMIT.
-- Persist only kitchen scheduling metadata; no contact/payment credentials.
CREATE TABLE public.master_wok_service_plans (
 service_date date PRIMARY KEY,
 plan jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_wok_service_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_service_plans FROM PUBLIC,anon,authenticated,service_role;
