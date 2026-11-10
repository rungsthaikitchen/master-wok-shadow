-- STAGING project hvrqgufqjslvgiohgkvu only; no production changes.
-- Resume the private browser candidate after the completed drain rehearsal.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
DO $$
BEGIN
 UPDATE master_wok_rehearsal.master_wok_launch_control
 SET mode='MASTER_WOK',revision=revision+1
 WHERE id=1 AND mode='DRAINING' AND revision=40
   AND approved_release_id='master-wok-delivery-2026-11-04';
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Staging launch control changed; stop and review before resuming';
 END IF;
END $$;
SELECT mode,approved_release_id,revision
FROM master_wok_rehearsal.master_wok_launch_control WHERE id=1;
COMMIT;
