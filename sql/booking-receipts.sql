-- Review-only. NOT applied to production. Existing orders remain the capacity
-- commitments; this table stores an immutable receipt, not a second order ledger.
CREATE TABLE public.master_wok_booking_receipts (
 key text PRIMARY KEY,
 service_date date NOT NULL,
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 fingerprint text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_wok_booking_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_wok_booking_receipts FROM PUBLIC, anon, authenticated;
-- The dedicated server database role must receive only the required privileges
-- after the whole writer/rollback protocol has been approved. No public RPC.
