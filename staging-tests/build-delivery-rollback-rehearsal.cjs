'use strict';
// Read-only live inputs, session-local copies only. No permanent mode/data writes.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const original=fs.readFileSync(path.join(__dirname,'../sql/delivery-rollback-guard.sql'),'utf8');
const guard=original.match(/DO \$guard\$[\s\S]*?\$guard\$;/)[0].replaceAll('public.','pg_temp.');
const sourceSha256=crypto.createHash('sha256').update(original).digest('hex');
process.stdout.write(`-- STAGING hvrqgufqjslvgiohgkvu only. All mutations target TEMP tables.
BEGIN;
CREATE TEMP TABLE master_wok_launch_control ON COMMIT DROP AS SELECT * FROM master_wok_rehearsal.master_wok_launch_control;
CREATE TEMP TABLE orders ON COMMIT DROP AS SELECT * FROM master_wok_rehearsal.orders WHERE order_ref IN ('RTK-186','RTK-187');
CREATE TEMP TABLE master_wok_service_plans ON COMMIT DROP AS SELECT * FROM master_wok_rehearsal.master_wok_service_plans WHERE service_date='2026-11-21';
CREATE TEMP TABLE booking_receipts ON COMMIT DROP AS SELECT * FROM master_wok_rehearsal.master_wok_booking_receipts WHERE order_id IN (SELECT id FROM pg_temp.orders);
CREATE TEMP TABLE rollback_proof(result jsonb) ON COMMIT DROP;
DO $rehearsal$
DECLARE
 guard_sql text := $guard_source$${guard}$guard_source$;
 step integer; issue text; expected text; checks jsonb := '[]'::jsonb;
 before_data text; after_data text; affected integer;
BEGIN
 IF (SELECT count(*) FROM pg_temp.orders)<>2 OR (SELECT count(*) FROM pg_temp.booking_receipts)<>2 OR
    (SELECT count(*) FROM pg_temp.master_wok_service_plans)<>1 THEN RAISE EXCEPTION 'EXPECTED_FIXTURES_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_temp.master_wok_launch_control WHERE id=1 AND mode='MASTER_WOK' AND revision=41) THEN
  RAISE EXCEPTION 'STAGING_CONTROL_CHANGED'; END IF;
 FOR step IN 1..5 LOOP
  IF step=1 THEN expected:='DELIVERY_ROLLBACK_REQUIRES_DRAIN'; END IF;
  IF step=2 THEN UPDATE pg_temp.master_wok_launch_control SET mode='DRAINING',revision=42; expected:='OUTSTANDING_DRIVER_TRIPS'; END IF;
  IF step=3 THEN UPDATE pg_temp.orders SET status='cancelled',is_test=true; expected:='OUTSTANDING_DRIVER_TRIPS'; END IF;
  IF step=4 THEN
   UPDATE pg_temp.master_wok_service_plans SET service_date=(clock_timestamp() AT TIME ZONE 'Europe/London')::date-1;
   UPDATE pg_temp.orders SET status='confirmed',is_test=false,preferred_time=clock_timestamp()+interval '1 hour',confirmed_time=clock_timestamp()+interval '1 hour',proposed_time=NULL;
   expected:='OUTSTANDING_DELIVERY_ORDERS';
  END IF;
  IF step=5 THEN UPDATE pg_temp.orders SET status='proposed',preferred_time=clock_timestamp()-interval '1 day',proposed_time=clock_timestamp()-interval '1 day',confirmed_time=NULL; expected:='OUTSTANDING_DELIVERY_ORDERS'; END IF;
  SELECT md5(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM pg_temp.orders o),'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY service_date) FROM pg_temp.master_wok_service_plans p),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY key) FROM pg_temp.booking_receipts r))::text) INTO before_data;
  issue:=NULL;
  BEGIN EXECUTE guard_sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS issue=MESSAGE_TEXT; END;
  IF issue IS DISTINCT FROM expected THEN RAISE EXCEPTION 'WRONG_GUARD_RESULT step %, actual %, expected %',step,issue,expected; END IF;
  SELECT md5(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM pg_temp.orders o),'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY service_date) FROM pg_temp.master_wok_service_plans p),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY key) FROM pg_temp.booking_receipts r))::text) INTO after_data;
  IF before_data<>after_data THEN RAISE EXCEPTION 'REFUSAL_CHANGED_RECORDS'; END IF;
  checks:=checks||jsonb_build_array(jsonb_build_object('case',step,'refusal',issue,'recordsPreserved',true));
 END LOOP;
 -- A completed-service snapshot. No live commitment is changed to create it.
 UPDATE pg_temp.orders SET status='customer_accepted_time',preferred_time=clock_timestamp()-interval '1 day',confirmed_time=clock_timestamp()-interval '1 day',proposed_time=NULL;
 UPDATE pg_temp.master_wok_launch_control SET mode='LEGACY',revision=revision+1 WHERE id=1 AND mode='DRAINING' AND revision=41;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'STALE_REVISION_SWITCHED_MODE'; END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('case','stale_revision','refused',true));
 SELECT md5(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM pg_temp.orders o),'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY service_date) FROM pg_temp.master_wok_service_plans p),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY key) FROM pg_temp.booking_receipts r))::text) INTO before_data;
 EXECUTE guard_sql;
 UPDATE pg_temp.master_wok_launch_control SET mode='LEGACY',revision=revision+1 WHERE id=1 AND mode='DRAINING' AND revision=42;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'GUARDED_RESTORE_FAILED'; END IF;
 SELECT md5(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM pg_temp.orders o),'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY service_date) FROM pg_temp.master_wok_service_plans p),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY key) FROM pg_temp.booking_receipts r))::text) INTO after_data;
 IF before_data<>after_data THEN RAISE EXCEPTION 'SUCCESSFUL_SWITCH_CHANGED_RECORDS'; END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('case','completed_service_restore','mode','LEGACY','revision',43,'recordsPreserved',true));
 INSERT INTO pg_temp.rollback_proof VALUES(jsonb_build_object('status','PASS','scope','TEMP_COPY_DELIVERY_ROLLBACK_GUARD_AND_PRESERVATION','guardSourceSha256','${sourceSha256}','checks',checks,'permanentMutations',0,'liveControl',(SELECT jsonb_build_object('mode',mode,'revision',revision) FROM master_wok_rehearsal.master_wok_launch_control WHERE id=1)));
END;
$rehearsal$;
SELECT result FROM pg_temp.rollback_proof;
ROLLBACK;
`);
