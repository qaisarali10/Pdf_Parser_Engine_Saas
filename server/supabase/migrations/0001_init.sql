-- SSR SaaS: initial Supabase schema.
-- Run this once against a fresh Supabase project (SQL editor, or `supabase db push`).
-- Replaces the MongoDB/Mongoose models under server/src/models/.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: app-specific fields for a Supabase auth.users row (name, role).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row when a user signs up. `name` comes from the
-- `data.name` option passed to supabase.auth.signUp() on the server.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- True when the caller (the JWT's auth.uid()) is an admin. Used by RLS
-- policies; the server itself always queries with the service-role key,
-- which bypasses RLS, so this matters only for any future direct client use.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Business tables. `user_id` replaces the Mongoose `user: ObjectId` owner
-- field; `legacy_id` preserves the Django-fixture primary key some rows were
-- originally seeded from (unique but nullable, same as the Mongoose index).
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer unique,
  cname text not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists companies_user_cname_idx on public.companies (user_id, cname);

create table if not exists public.distributors (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer unique,
  company_id uuid references public.companies(id) on delete set null,
  did integer not null default 1,
  dname text not null,
  area text not null default '',
  subarea text not null default '',
  cell text not null default '',
  status boolean not null default true,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists distributors_user_company_idx on public.distributors (user_id, company_id);
create index if not exists distributors_user_dname_idx on public.distributors (user_id, dname);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer unique,
  company_id uuid references public.companies(id) on delete set null,
  pname text not null,
  ptype text not null default 'Retail' check (ptype in ('Retail', 'Trade')),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_user_company_idx on public.products (user_id, company_id);
create index if not exists products_user_pname_idx on public.products (user_id, pname);

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer unique,
  product_id uuid not null references public.products(id) on delete cascade,
  paname text not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_aliases_paname_idx on public.product_aliases (paname);
create index if not exists product_aliases_user_product_idx on public.product_aliases (user_id, product_id);

create table if not exists public.product_schemes (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer unique,
  product_id uuid not null references public.products(id) on delete cascade,
  schemeid integer not null,
  basepolicy numeric not null default 0,
  bonuspolicy numeric not null default 0,
  tp numeric not null default 0,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_schemes_product_tp_scheme_idx on public.product_schemes (product_id, tp, schemeid desc);
create index if not exists product_schemes_user_product_idx on public.product_schemes (user_id, product_id);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer unique,
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  alias text not null,
  sqty numeric not null default 0,
  sbonus numeric not null default 0,
  sprice numeric not null default 0,
  salvalue numeric not null default 0,
  clqty numeric not null default 0,
  clbonus numeric not null default 0,
  clvalue numeric not null default 0,
  pbase numeric not null default 0,
  pbonus numeric not null default 0,
  tprice numeric not null default 0,
  seg_base numeric not null default 0,
  seg_bonus numeric not null default 0,
  seg_bsunit numeric not null default 0,
  seg_bnunit numeric not null default 0,
  seg_slbase numeric not null default 0,
  seg_slbonus numeric not null default 0,
  seg_slbsunit numeric not null default 0,
  seg_slbnunit numeric not null default 0,
  month text not null default 'jan',
  year integer not null default 2000,
  date timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_distributor_date_idx on public.sales (distributor_id, date desc);
create index if not exists sales_month_year_idx on public.sales (month, year);
create index if not exists sales_user_distributor_date_idx on public.sales (user_id, distributor_id, date desc);
create index if not exists sales_user_month_year_idx on public.sales (user_id, month, year);
create index if not exists sales_user_month_date_idx on public.sales (user_id, month, date desc);
create index if not exists sales_user_month_year_date_idx on public.sales (user_id, month, year, date desc);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Other',
  description text not null default '',
  price numeric not null default 0,
  status boolean not null default true,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists services_user_name_idx on public.services (user_id, name);

create table if not exists public.upload_logs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  filename text not null default '',
  status text not null default 'processed',
  row_count integer not null default 0,
  created integer not null default 0,
  skipped integer not null default 0,
  inserted integer not null default 0,
  missing_count integer not null default 0,
  session_key text not null default 'default',
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists upload_logs_created_idx on public.upload_logs (created_at desc);
create index if not exists upload_logs_user_created_idx on public.upload_logs (user_id, created_at desc);

create table if not exists public.temp_missing_products (
  id uuid primary key default gen_random_uuid(),
  product text not null,
  session_key text not null default 'default',
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists temp_missing_products_user_session_idx on public.temp_missing_products (user_id, session_key);

-- `user_id` is text, not a FK: it also records the built-in (non-Supabase)
-- administrator's synthetic id, mirroring the Mongoose `Mixed` type today.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default '',
  action text not null,
  resource text not null,
  resource_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  ip_address text not null default '',
  user_agent text not null default '',
  status text not null default 'success' check (status in ('success', 'failure')),
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_action_created_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_resource_created_idx on public.audit_logs (resource, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_user_idx on public.audit_logs (user_id);

-- ---------------------------------------------------------------------------
-- RLS: defense-in-depth. The Express server always queries with the
-- service-role key (bypasses RLS) and enforces ownership itself in
-- server/src/utils/ownership.js, exactly as it did against MongoDB. These
-- policies only matter if a client ever queries Supabase directly.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'distributors', 'products', 'product_aliases', 'product_schemes',
    'sales', 'services', 'upload_logs', 'temp_missing_products'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid())',
      t || '_owner_access', t
    );
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy profiles_self_access on public.profiles
  for select using (public.is_admin() or id = auth.uid());
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

alter table public.audit_logs enable row level security;
create policy audit_logs_owner_access on public.audit_logs
  for select using (public.is_admin() or user_id = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- RPC functions: the transactional / aggregation operations MongoStore did
-- with sessions and the aggregation pipeline.
-- ---------------------------------------------------------------------------

-- Ranks a month code the way MONTH_ORDER did (`$indexOfArray`).
create or replace function public.month_rank(p_month text)
returns integer
language sql
immutable
as $$
  select case lower(p_month)
    when 'jan' then 1 when 'feb' then 2 when 'mar' then 3 when 'apr' then 4
    when 'may' then 5 when 'jun' then 6 when 'jul' then 7 when 'aug' then 8
    when 'sep' then 9 when 'oct' then 10 when 'nov' then 11 when 'dec' then 12
    else 0
  end;
$$;

-- Deletes the caller's schemes and inserts the replacement set atomically.
-- Mirrors MongoStore.replaceSchemes(): only the owner's rows are touched.
create or replace function public.replace_schemes(p_user uuid, p_schemes jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  inserted_count integer;
begin
  delete from public.product_schemes where user_id = p_user;

  insert into public.product_schemes (user_id, product_id, schemeid, basepolicy, bonuspolicy, tp)
  select p_user,
    (item->>'productId')::uuid,
    coalesce((item->>'schemeid')::integer, 0),
    coalesce((item->>'basepolicy')::numeric, 0),
    coalesce((item->>'bonuspolicy')::numeric, 0),
    coalesce((item->>'tp')::numeric, 0)
  from jsonb_array_elements(p_schemes) as item;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Bulk-inserts a batch of sales atomically and returns the created rows.
create or replace function public.insert_sales_batch(p_user uuid, p_sales jsonb)
returns setof public.sales
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  insert into public.sales (
    user_id, distributor_id, product_id, alias, sqty, sbonus, sprice, salvalue,
    clqty, clbonus, clvalue, pbase, pbonus, tprice,
    seg_base, seg_bonus, seg_bsunit, seg_bnunit,
    seg_slbase, seg_slbonus, seg_slbsunit, seg_slbnunit,
    month, year, date
  )
  select
    p_user,
    (item->>'distributorId')::uuid,
    (item->>'productId')::uuid,
    item->>'alias',
    coalesce((item->>'sqty')::numeric, 0), coalesce((item->>'sbonus')::numeric, 0),
    coalesce((item->>'sprice')::numeric, 0), coalesce((item->>'salvalue')::numeric, 0),
    coalesce((item->>'clqty')::numeric, 0), coalesce((item->>'clbonus')::numeric, 0),
    coalesce((item->>'clvalue')::numeric, 0), coalesce((item->>'pbase')::numeric, 0),
    coalesce((item->>'pbonus')::numeric, 0), coalesce((item->>'tprice')::numeric, 0),
    coalesce((item->>'seg_base')::numeric, 0), coalesce((item->>'seg_bonus')::numeric, 0),
    coalesce((item->>'seg_bsunit')::numeric, 0), coalesce((item->>'seg_bnunit')::numeric, 0),
    coalesce((item->>'seg_slbase')::numeric, 0), coalesce((item->>'seg_slbonus')::numeric, 0),
    coalesce((item->>'seg_slbsunit')::numeric, 0), coalesce((item->>'seg_slbnunit')::numeric, 0),
    coalesce(item->>'month', 'jan'),
    coalesce((item->>'year')::integer, 2000),
    coalesce((item->>'date')::timestamptz, now())
  from jsonb_array_elements(p_sales) as item
  returning *;
end;
$$;

-- Most recent (month, year) with at least one sale, ranked by year then
-- month_rank(). Matches MongoStore.latestSalesPeriod().
create or replace function public.latest_sales_period(p_user uuid, p_is_admin boolean)
returns table (month text, year integer)
language sql
stable
security definer set search_path = public
as $$
  select s.month, s.year
  from public.sales s
  where (p_is_admin or s.user_id = p_user)
    and s.month is not null and s.year is not null
    and public.month_rank(s.month) > 0
  order by s.year desc, public.month_rank(s.month) desc
  limit 1;
$$;

-- Every distinct (month, year) with a row count. Matches
-- MongoStore.summaryPeriods().
create or replace function public.summary_periods(p_user uuid, p_is_admin boolean)
returns table (month text, year integer, count bigint)
language sql
stable
security definer set search_path = public
as $$
  select s.month, s.year, count(*)::bigint
  from public.sales s
  where (p_is_admin or s.user_id = p_user)
    and s.month is not null and s.year is not null
    and public.month_rank(s.month) > 0
  group by s.month, s.year
  order by s.year desc, public.month_rank(s.month) desc;
$$;

-- Sales grouped by (month, year), value totals included. Used by both the
-- monthly-sales report and the dashboard's monthly chart.
create or replace function public.sales_by_period(
  p_user uuid, p_is_admin boolean,
  p_from timestamptz default null, p_to timestamptz default null,
  p_distributor_id uuid default null, p_product_id uuid default null,
  p_product_ids uuid[] default null, p_distributor_ids uuid[] default null
)
returns table (month text, year integer, rows bigint, sales_value numeric, closing_value numeric)
language sql
stable
security definer set search_path = public
as $$
  select s.month, s.year, count(*)::bigint, coalesce(sum(s.salvalue), 0), coalesce(sum(s.clvalue), 0)
  from public.sales s
  where (p_is_admin or s.user_id = p_user)
    and (p_from is null or s.date >= p_from)
    and (p_to is null or s.date <= p_to)
    and (p_distributor_id is null or s.distributor_id = p_distributor_id)
    and (p_product_id is null or s.product_id = p_product_id)
    and ((p_product_ids is null and p_distributor_ids is null) or s.product_id = any(p_product_ids) or s.distributor_id = any(p_distributor_ids))
  group by s.month, s.year;
$$;

-- Sales grouped by ISO week (dashboard's weekly chart).
create or replace function public.sales_by_week(p_user uuid, p_is_admin boolean, p_limit integer default 12)
returns table (week timestamptz, rows bigint, sales_value numeric)
language sql
stable
security definer set search_path = public
as $$
  select date_trunc('week', s.date) as week, count(*)::bigint, coalesce(sum(s.clvalue), 0)
  from public.sales s
  where (p_is_admin or s.user_id = p_user)
  group by 1
  order by 1 desc
  limit p_limit;
$$;

-- Sales grouped by distributor, joined to the distributor/company names.
create or replace function public.sales_by_distributor(
  p_user uuid, p_is_admin boolean,
  p_from timestamptz default null, p_to timestamptz default null,
  p_distributor_id uuid default null, p_product_id uuid default null,
  p_product_ids uuid[] default null, p_distributor_ids uuid[] default null
)
returns table (distributor_id uuid, distributor_name text, company_name text, rows bigint, sales_value numeric, closing_value numeric)
language sql
stable
security definer set search_path = public
as $$
  select s.distributor_id, d.dname, c.cname,
    count(*)::bigint, coalesce(sum(s.salvalue), 0), coalesce(sum(s.clvalue), 0)
  from public.sales s
  left join public.distributors d on d.id = s.distributor_id
  left join public.companies c on c.id = d.company_id
  where (p_is_admin or s.user_id = p_user)
    and (p_from is null or s.date >= p_from)
    and (p_to is null or s.date <= p_to)
    and (p_distributor_id is null or s.distributor_id = p_distributor_id)
    and (p_product_id is null or s.product_id = p_product_id)
    and ((p_product_ids is null and p_distributor_ids is null) or s.product_id = any(p_product_ids) or s.distributor_id = any(p_distributor_ids))
  group by s.distributor_id, d.dname, c.cname;
$$;

-- Sales grouped by product, joined to the product/company names.
create or replace function public.sales_by_product(
  p_user uuid, p_is_admin boolean,
  p_from timestamptz default null, p_to timestamptz default null,
  p_distributor_id uuid default null, p_product_id uuid default null,
  p_product_ids uuid[] default null, p_distributor_ids uuid[] default null
)
returns table (product_id uuid, product_name text, company_name text, rows bigint, sales_value numeric, closing_value numeric)
language sql
stable
security definer set search_path = public
as $$
  select s.product_id, p.pname, c.cname,
    count(*)::bigint, coalesce(sum(s.salvalue), 0), coalesce(sum(s.clvalue), 0)
  from public.sales s
  left join public.products p on p.id = s.product_id
  left join public.companies c on c.id = p.company_id
  where (p_is_admin or s.user_id = p_user)
    and (p_from is null or s.date >= p_from)
    and (p_to is null or s.date <= p_to)
    and (p_distributor_id is null or s.distributor_id = p_distributor_id)
    and (p_product_id is null or s.product_id = p_product_id)
    and ((p_product_ids is null and p_distributor_ids is null) or s.product_id = any(p_product_ids) or s.distributor_id = any(p_distributor_ids))
  group by s.product_id, p.pname, c.cname;
$$;

-- Sales grouped by the (product, distributor) pair -- used to attribute
-- totals to a company through either side, for the company report.
create or replace function public.sales_by_product_distributor_pair(
  p_user uuid, p_is_admin boolean,
  p_from timestamptz default null, p_to timestamptz default null,
  p_distributor_id uuid default null, p_product_id uuid default null
)
returns table (product_id uuid, distributor_id uuid, rows bigint, sales_value numeric)
language sql
stable
security definer set search_path = public
as $$
  select s.product_id, s.distributor_id, count(*)::bigint, coalesce(sum(s.salvalue), 0)
  from public.sales s
  where (p_is_admin or s.user_id = p_user)
    and (p_from is null or s.date >= p_from)
    and (p_to is null or s.date <= p_to)
    and (p_distributor_id is null or s.distributor_id = p_distributor_id)
    and (p_product_id is null or s.product_id = p_product_id)
  group by s.product_id, s.distributor_id;
$$;

-- Upload activity grouped by day (dashboard's upload-activity chart).
create or replace function public.upload_activity_by_day(p_user uuid, p_is_admin boolean, p_limit integer default 14)
returns table (day timestamptz, uploads bigint, rows bigint)
language sql
stable
security definer set search_path = public
as $$
  select date_trunc('day', u.created_at) as day, count(*)::bigint, coalesce(sum(u.row_count), 0)::bigint
  from public.upload_logs u
  where (p_is_admin or u.user_id = p_user)
  group by 1
  order by 1 desc
  limit p_limit;
$$;
