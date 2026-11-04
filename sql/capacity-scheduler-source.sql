-- Review only. Keep this non-destructive compatibility column on rollback.
-- Legacy capacity hints can then retain pending Master Wok time commitments
-- without changing the semantics of imported legacy proposals.
ALTER TABLE public.orders ADD COLUMN capacity_scheduler text NOT NULL DEFAULT 'LEGACY'
 CHECK(capacity_scheduler IN ('LEGACY','MASTER_WOK'));
