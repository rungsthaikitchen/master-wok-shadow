-- REVIEW ONLY. Requires launch-control.sql and explicit production approval.
-- Keep existing table grants/RLS policies: LEGACY rollback does not need to
-- rebuild them. This additional fence also covers service_role (RLS bypass).
-- Only the nonsecret mode is readable by API roles, never release approval.
REVOKE ALL ON public.master_wok_launch_control FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT(id,mode) ON public.master_wok_launch_control TO anon,authenticated,service_role;
CREATE POLICY master_wok_mode_read ON public.master_wok_launch_control
 FOR SELECT TO anon,authenticated,service_role USING (id=1);

CREATE FUNCTION public.master_wok_lock_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE launch_mode text;
BEGIN
 -- BEFORE STATEMENT: lock before row locks, including legacy REST writes.
 PERFORM pg_advisory_xact_lock(hashtextextended('rtk-authoritative-booking',47824));
 IF TG_OP='TRUNCATE' THEN
  SELECT mode INTO launch_mode FROM public.master_wok_launch_control WHERE id=1;
  IF launch_mode IS DISTINCT FROM 'LEGACY' THEN
   RAISE EXCEPTION 'MASTER_WOK_WRITE_REQUIRED' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NULL;
END;
$$;

CREATE FUNCTION public.master_wok_check_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE launch_mode text;
BEGIN
 SELECT mode INTO launch_mode FROM public.master_wok_launch_control WHERE id=1;
 IF launch_mode='LEGACY' THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 -- Limited backend bookkeeping is safe while draining or awaiting retries.
 -- No API customer role may use this exception; no status, basket, amount,
 -- test flag, customer details or reservation time is exempted.
 IF launch_mode IN ('DRAINING','MASTER_WOK') AND TG_TABLE_NAME='orders'
    AND TG_OP='UPDATE' AND current_user IN ('postgres','service_role','master_wok_writer') THEN
  IF (to_jsonb(NEW)-ARRAY['staff_notified_at','staff_notify_attempts','staff_notify_error','loyalty_settled','updated_at'])
   = (to_jsonb(OLD)-ARRAY['staff_notified_at','staff_notify_attempts','staff_notify_error','loyalty_settled','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;
 -- A client-set GUC alone is never authority. The writer is a direct SQL
 -- connection, not a service-role REST request or browser RPC.
 IF launch_mode='MASTER_WOK' AND current_user IN ('postgres','master_wok_writer')
    AND session_user IN ('postgres','master_wok_writer')
    AND current_setting('master_wok.authoritative_writer',true)='1' THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'MASTER_WOK_WRITE_REQUIRED' USING ERRCODE='42501';
END;
$$;

CREATE TRIGGER master_wok_statement_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON public.orders FOR EACH STATEMENT EXECUTE FUNCTION public.master_wok_lock_write();
CREATE TRIGGER master_wok_row_fence BEFORE INSERT OR UPDATE OR DELETE
 ON public.orders FOR EACH ROW EXECUTE FUNCTION public.master_wok_check_write();
CREATE TRIGGER master_wok_statement_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON public.order_items FOR EACH STATEMENT EXECUTE FUNCTION public.master_wok_lock_write();
CREATE TRIGGER master_wok_row_fence BEFORE INSERT OR UPDATE OR DELETE
 ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.master_wok_check_write();
CREATE TRIGGER master_wok_statement_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON public.service_state FOR EACH STATEMENT EXECUTE FUNCTION public.master_wok_lock_write();
CREATE TRIGGER master_wok_row_fence BEFORE INSERT OR UPDATE OR DELETE
 ON public.service_state FOR EACH ROW EXECUTE FUNCTION public.master_wok_check_write();
CREATE TRIGGER master_wok_statement_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON public.booking_blackouts FOR EACH STATEMENT EXECUTE FUNCTION public.master_wok_lock_write();
CREATE TRIGGER master_wok_row_fence BEFORE INSERT OR UPDATE OR DELETE
 ON public.booking_blackouts FOR EACH ROW EXECUTE FUNCTION public.master_wok_check_write();

-- Rollback: acquire the same global advisory lock, set durable mode DRAINING,
-- resolve unknown checkout attempts, then restore LEGACY routing and durable
-- mode under that lock. Leave these triggers and all committed orders intact.
-- Validate table grants/policies and old-tab behavior before reopening.
