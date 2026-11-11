-- Private STAGING project hvrqgufqjslvgiohgkvu only.
-- Enables only the synthetic-fixture candidate deployed as version 46.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
UPDATE master_wok_rehearsal.master_wok_launch_control
SET mode='MASTER_WOK',approved_release_id='master-wok-delivery-2026-11-04',revision=revision+1
WHERE id=1 AND mode='LEGACY' AND approved_release_id IS NULL AND revision=38;
SELECT mode,approved_release_id,revision
FROM master_wok_rehearsal.master_wok_launch_control WHERE id=1;
COMMIT;
