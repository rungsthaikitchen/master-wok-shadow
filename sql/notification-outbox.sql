-- Review only. Created in the order transaction; browser retries cannot send
-- duplicate order-created events or debit loyalty as a notification side effect.
CREATE TABLE public.master_wok_notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 event_type text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 sent_at timestamptz,
 lease_token uuid,
 leased_until timestamptz,
 prepared_messages jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,event_type)
);
ALTER TABLE public.master_wok_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_notification_outbox FROM PUBLIC,anon,authenticated;

CREATE TABLE public.master_wok_notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.master_wok_notification_outbox(id) ON DELETE CASCADE,
 delivery_key text NOT NULL,
 message jsonb NOT NULL,
 fallback jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 provider_id text,
 UNIQUE(event_id,delivery_key)
);
ALTER TABLE public.master_wok_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_notification_deliveries FROM PUBLIC,anon,authenticated;
