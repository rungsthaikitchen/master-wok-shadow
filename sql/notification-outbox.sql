-- Review only. Created in the order transaction; browser retries cannot send
-- duplicate order-created events or debit loyalty as a notification side effect.
CREATE TABLE public.master_wok_notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 event_type text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,event_type)
);
ALTER TABLE public.master_wok_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_notification_outbox FROM PUBLIC,anon,authenticated;
