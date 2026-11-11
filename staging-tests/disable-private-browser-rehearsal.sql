-- Private STAGING project hvrqgufqjslvgiohgkvu only. Drains active writes
-- under the same lock before disabling the private browser candidate.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
UPDATE master_wok_rehearsal.master_wok_launch_control
SET mode='LEGACY',approved_release_id=NULL,revision=revision+1
WHERE id=1 AND approved_release_id='master-wok-delivery-2026-11-04';
SELECT mode,approved_release_id,revision
FROM master_wok_rehearsal.master_wok_launch_control WHERE id=1;
COMMIT;
