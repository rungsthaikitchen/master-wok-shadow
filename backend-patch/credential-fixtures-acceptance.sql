-- Run only on staging. All data changes roll back.
begin;
do $$
declare t text;
begin
 foreach t in array array['master_wok_credential_customers','master_wok_credential_orders','master_wok_credential_loyalty_accounts'] loop
  if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then
   raise exception 'PUBLIC_FIXTURE_GRANT_REFUSED';
  end if;
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then
   raise exception 'RLS_REQUIRED';
  end if;
  if exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and not tgisinternal) then
   raise exception 'EXTERNAL_TRIGGER_REFUSED';
  end if;
 end loop;
 if exists(select 1 from public.master_wok_credential_customers)
 or exists(select 1 from public.master_wok_credential_orders)
 or exists(select 1 from public.master_wok_credential_loyalty_accounts) then
  raise exception 'EMPTY_FIXTURES_REQUIRED';
 end if;
 begin
  insert into public.master_wok_credential_customers(id,full_name,phone,email)
  values('11111111-1111-4111-8111-111111111123','REAL DATA REFUSED','+440000000023','key-trial@example.invalid');
  raise exception 'IDENTITY_CHECK_MISSING';
 exception when check_violation then null;
 end;
 insert into public.master_wok_credential_customers(id,full_name,phone,email)
 values('11111111-1111-4111-8111-111111111123','SYNTHETIC KEY TRIAL','+440000000023','key-trial@example.invalid');
 insert into public.master_wok_credential_orders(id,customer_id,created_at,status,loyalty_points_earned_pending)
 values('22222222-2222-4222-8222-222222222223','11111111-1111-4111-8111-111111111123',now(),'completed',32);
 insert into public.master_wok_credential_loyalty_accounts(customer_phone,customer_email,points_balance,lifetime_points)
 values('+440000000023','key-trial@example.invalid',132,132);
 update public.master_wok_credential_loyalty_accounts set points_balance=points_balance-100 where customer_phone='+440000000023';
 if not exists(select 1 from public.master_wok_credential_loyalty_accounts where points_balance=32 and lifetime_points=132) then
  raise exception 'FIXTURE_UPDATE_FAILED';
 end if;
 begin
  insert into public.master_wok_credential_loyalty_accounts(customer_phone) values('+441234567890');
  raise exception 'PHONE_CHECK_MISSING';
 exception when check_violation then null;
 end;
 begin
  insert into public.master_wok_credential_orders(id,created_at,status) values('99999999-9999-4999-8999-999999999999',now(),'pending');
  raise exception 'ORDER_CHECK_MISSING';
 exception when check_violation then null;
 end;
end $$;
rollback;
select jsonb_build_object(
 'status','PASSED',
 'fixtureCustomers',(select count(*) from public.master_wok_credential_customers),
 'fixtureOrders',(select count(*) from public.master_wok_credential_orders),
 'fixtureLoyaltyAccounts',(select count(*) from public.master_wok_credential_loyalty_accounts),
 'publicGrants',false,'productionWrites',0
) as fixture_acceptance;
