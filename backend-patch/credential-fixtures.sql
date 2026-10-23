-- STAGING ONLY. Isolated subset of backend columns; no real customer data.
create table public.master_wok_credential_customers (
 id uuid primary key check (id='11111111-1111-4111-8111-111111111123'),
 full_name text not null check (full_name='SYNTHETIC KEY TRIAL'),
 email text check (email='key-trial@example.invalid'),
 phone text check (phone='+440000000023')
);
create table public.master_wok_credential_orders (
 id uuid primary key check (id in ('22222222-2222-4222-8222-222222222223','33333333-3333-4333-8333-333333333323')),
 customer_id uuid references public.master_wok_credential_customers(id),
 created_at timestamptz not null,
 preferred_time timestamptz,
 proposed_time timestamptz,
 confirmed_time timestamptz,
 status text not null,
 loyalty_points_earned_pending integer not null default 0,
 loyalty_points_redeem_pending integer not null default 0,
 loyalty_settled boolean not null default false,
 is_test boolean not null default true check(is_test)
);
create table public.master_wok_credential_loyalty_accounts (
 id uuid primary key default gen_random_uuid(),
 customer_phone text unique not null check (customer_phone='+440000000023'),
 customer_email text check (customer_email='key-trial@example.invalid'),
 points_balance integer not null default 0,
 lifetime_points integer not null default 0,
 last_order_at timestamptz,
 created_at timestamptz default now(),
 updated_at timestamptz default now()
);
alter table public.master_wok_credential_customers enable row level security;
alter table public.master_wok_credential_orders enable row level security;
alter table public.master_wok_credential_loyalty_accounts enable row level security;
revoke all on public.master_wok_credential_customers,public.master_wok_credential_orders,public.master_wok_credential_loyalty_accounts from public,anon,authenticated;
grant select,insert,update,delete on public.master_wok_credential_customers,public.master_wok_credential_orders,public.master_wok_credential_loyalty_accounts to service_role;
create policy credential_service_only on public.master_wok_credential_customers for all to service_role using (true) with check (true);
create policy credential_service_only on public.master_wok_credential_orders for all to service_role using (true) with check (true);
create policy credential_service_only on public.master_wok_credential_loyalty_accounts for all to service_role using (true) with check (true);
notify pgrst,'reload schema';
