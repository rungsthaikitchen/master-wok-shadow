-- Run only in STAGING project hvrqgufqjslvgiohgkvu.
-- Pauses authoritative booking writes; preserves orders, plans and receipts.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
DO $$
BEGIN
 UPDATE master_wok_rehearsal.master_wok_launch_control
 SET mode='DRAINING',revision=revision+1
 WHERE id=1 AND mode='MASTER_WOK' AND revision=39
   AND approved_release_id='master-wok-delivery-2026-11-04';
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Staging launch control changed; stop and review before draining';
 END IF;
END $$;
SELECT mode,approved_release_id,revision
FROM master_wok_rehearsal.master_wok_launch_control WHERE id=1;
COMMIT;
