-- STAGING ONLY: isolated concurrency mechanism proof, not Master Wok capacity booking.
-- Run only against project rtk-master-wok-staging (hvrqgufqjslvgiohgkvu).
-- Never run against RTK production. Does not touch existing public.orders.
create schema if not exists master_wok_test;

create table if not exists master_wok_test.slot_reservations (
  idempotency_key text primary key,
  service_date date not null,
  slot_minute integer not null check (slot_minute between 0 and 1439),
  created_at timestamptz not null default now()
);

-- This schema is private, and no browser roles should access it.
revoke all on schema master_wok_test from public, anon, authenticated;
revoke all on master_wok_test.slot_reservations from public, anon, authenticated;

create or replace function master_wok_test.reserve_demo(
  p_key text, p_date date, p_slot integer, p_capacity integer
) returns text
language plpgsql security invoker
set search_path = pg_catalog, master_wok_test
as $function$
declare
  prior master_wok_test.slot_reservations%rowtype;
  used_count integer;
begin
  if p_key is null or length(trim(p_key)) = 0 or p_date is null
    or p_slot is null or p_slot < 0 or p_slot > 1439
    or p_capacity is null or p_capacity < 1 then
    return 'INVALID';
  end if;
  -- One transaction-scoped lock per service date and slot.
  perform pg_advisory_xact_lock(
    hashtextextended(p_date::text || ':' || p_slot::text, 47821)
  );
  select * into prior
    from master_wok_test.slot_reservations
    where idempotency_key = p_key;
  if found then
    if prior.service_date = p_date and prior.slot_minute = p_slot then
      return 'REPLAY';
    end if;
    return 'CONFLICT';
  end if;
  select count(*) into used_count
    from master_wok_test.slot_reservations
    where service_date = p_date and slot_minute = p_slot;
  if used_count >= p_capacity then return 'FULL'; end if;
  insert into master_wok_test.slot_reservations
    (idempotency_key, service_date, slot_minute)
    values (p_key, p_date, p_slot);
  return 'RESERVED';
end;
$function$;

revoke all on function master_wok_test.reserve_demo(text,date,integer,integer)
  from public, anon, authenticated;

-- Sequential smoke test, safe in staging and rolled back:
begin;
select master_wok_test.reserve_demo('smoke-a','2026-11-01',1140,1) as first_booking;
select master_wok_test.reserve_demo('smoke-b','2026-11-01',1140,1) as competing_booking;
select master_wok_test.reserve_demo('smoke-a','2026-11-01',1140,1) as replay;
rollback;

-- Expected: RESERVED, FULL, REPLAY.
-- True concurrency test MUST run from two independent database connections;
-- sequential SQL statements alone do not prove locking under contention.
-- This function is a test fixture ONLY: slot-counting is not the Master Wok
-- production scheduling algorithm. It must never be used to book real orders.
