-- STAGING ONLY: hvrqgufqjslvgiohgkvu. No production database changes.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_type text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_lat double precision;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_lng double precision;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee numeric;
-- Nullable, without defaults: do not invent types/coordinates for old fixtures.
CREATE SCHEMA IF NOT EXISTS master_wok_delivery_test;
REVOKE ALL ON SCHEMA master_wok_delivery_test FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS master_wok_delivery_test.cases (
 case_key text PRIMARY KEY CHECK (case_key ~ '^[A-Z0-9_]{1,64}$'),
 service_date date NOT NULL,
 assessed_at timestamptz NOT NULL,
 expected_orders integer NOT NULL CHECK (expected_orders BETWEEN 1 AND 500),
 expected_items integer NOT NULL CHECK (expected_items BETWEEN 1 AND 5000),
 order_aliases jsonb NOT NULL CHECK (jsonb_typeof(order_aliases)='object'),
 candidate_ids jsonb NOT NULL CHECK (jsonb_typeof(candidate_ids)='array'),
 planning_evidence jsonb NOT NULL CHECK (jsonb_typeof(planning_evidence)='object'),
 expected_prediction text NOT NULL CHECK (expected_prediction IN ('RECOMMENDED','UNVERIFIED')),
 expected_kind text CHECK (expected_kind IN ('COMBINED','SEPARATE')),
 data_origin text NOT NULL DEFAULT 'SYNTHETIC_STAGING' CHECK (data_origin='SYNTHETIC_STAGING')
);
CREATE TABLE IF NOT EXISTS master_wok_delivery_test.observations (
 observation_key text PRIMARY KEY CHECK (observation_key ~ '^[a-f0-9]{64}$'),
 case_key text NOT NULL REFERENCES master_wok_delivery_test.cases(case_key),
 record jsonb NOT NULL CHECK (COALESCE(jsonb_typeof(record)='object' AND record->>'dataOrigin'='SYNTHETIC_STAGING'
  AND record->>'verified'='false' AND record->>'sourceEvidence'='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY'
  AND record->>'observationKey'=observation_key AND record->>'caseKey'=case_key,false)),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS observations_case_key_idx ON master_wok_delivery_test.observations(case_key);
ALTER TABLE master_wok_delivery_test.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_wok_delivery_test.observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA master_wok_delivery_test FROM PUBLIC, anon, authenticated, service_role;
-- Only the controlled staging test orchestrator writes using its existing admin
-- connection. No anonymous API policies, public RPC or live worker is installed.
