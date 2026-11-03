-- Staged Google Play entitlements. Apply only after the Android Publisher API
-- service account, purchase tests and voice cutoff design are verified.
-- This migration does not grant credits to existing users.
create table if not exists public.mss_voice_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_remaining_ms bigint not null default 0 check (monthly_remaining_ms >= 0),
  topup_remaining_ms bigint not null default 0 check (topup_remaining_ms >= 0),
  monthly_valid_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.mss_play_purchase_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  first_seen_at timestamptz not null default now()
);
create table if not exists public.mss_voice_credit_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null references public.mss_play_purchase_tokens(token_hash),
  grant_key text not null unique,
  product_id text not null check (product_id in
    ('mss_premium', 'mss_voice_60', 'mss_voice_120', 'mss_voice_300', 'mss_voice_600')),
  minutes_granted integer not null check (minutes_granted in (60,120,300,600)),
  order_id text,
  period_end timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mss_voice_credit_grants_user_time
  on public.mss_voice_credit_grants (user_id, created_at desc);

alter table public.mss_voice_wallets enable row level security;
alter table public.mss_play_purchase_tokens enable row level security;
alter table public.mss_voice_credit_grants enable row level security;

-- Readable only by the owner; no client-side writes, credits are verified server side.
revoke all on public.mss_voice_wallets from anon, authenticated;
revoke all on public.mss_play_purchase_tokens from anon, authenticated;
revoke all on public.mss_voice_credit_grants from anon, authenticated;
grant select on public.mss_voice_wallets to authenticated;
grant select on public.mss_voice_credit_grants to authenticated;

drop policy if exists mss_wallet_owner_read on public.mss_voice_wallets;
create policy mss_wallet_owner_read on public.mss_voice_wallets for select
to authenticated using ((select auth.uid()) = user_id);
drop policy if exists mss_grants_owner_read on public.mss_voice_credit_grants;
create policy mss_grants_owner_read on public.mss_voice_credit_grants for select
to authenticated using ((select auth.uid()) = user_id);

-- Atomic, idempotent grant. Only a trusted server can call this function.
create or replace function public.mss_apply_verified_play_purchase(
  p_user_id uuid, p_product_id text, p_token_hash text,
  p_period_end timestamptz default null, p_order_id text default null
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_grant_key text;
  v_minutes integer;
  v_inserted integer;
  v_existing_end timestamptz;
begin
  if p_user_id is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_purchase_identity';
  end if;
  v_minutes := case p_product_id
    when 'mss_premium' then 60
    when 'mss_voice_60' then 60
    when 'mss_voice_120' then 120
    when 'mss_voice_300' then 300
    when 'mss_voice_600' then 600
    else null end;
  if v_minutes is null then raise exception 'invalid_product_id'; end if;
  if p_product_id = 'mss_premium' and
     (p_period_end is null or p_period_end <= now()) then
    raise exception 'inactive_billing_period';
  end if;
  insert into public.mss_voice_wallets(user_id) values(p_user_id)
    on conflict (user_id) do nothing;
  perform 1 from public.mss_voice_wallets where user_id=p_user_id for update;

  insert into public.mss_play_purchase_tokens(token_hash, user_id)
    values(p_token_hash, p_user_id) on conflict (token_hash) do nothing;
  select user_id into v_owner from public.mss_play_purchase_tokens
    where token_hash=p_token_hash for update;
  if v_owner is distinct from p_user_id then
    raise exception 'purchase_token_belongs_to_another_account';
  end if;

  -- One-time top-ups are unique by purchase token. Subscription grants are
  -- unique per verified provider period end, so repeats cannot grant twice.
  v_grant_key := case when p_product_id = 'mss_premium'
    then p_token_hash || ':premium:' || to_char(p_period_end at time zone 'UTC', 'YYYYMMDDHH24MISS.US')
    else p_token_hash || ':topup' end;

  insert into public.mss_voice_credit_grants
    (user_id,token_hash,grant_key,product_id,minutes_granted,order_id,period_end)
    values(p_user_id,p_token_hash,v_grant_key,p_product_id,v_minutes,p_order_id,p_period_end)
    on conflict (grant_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    if p_product_id = 'mss_premium' then
      select monthly_valid_until into v_existing_end
        from public.mss_voice_wallets where user_id=p_user_id;
      if v_existing_end is null or p_period_end > v_existing_end then
        update public.mss_voice_wallets set
          monthly_remaining_ms=3600000,
          monthly_valid_until=p_period_end,
          updated_at=now()
          where user_id=p_user_id;
      end if;
    else
      update public.mss_voice_wallets set
        topup_remaining_ms=topup_remaining_ms+v_minutes*60000,
        updated_at=now()
        where user_id=p_user_id;
    end if;
  end if;
  return jsonb_build_object('credited',v_inserted=1,'productId',p_product_id,'minutes',v_minutes);
end $$;

revoke all on function public.mss_apply_verified_play_purchase(uuid,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.mss_apply_verified_play_purchase(uuid,text,text,timestamptz,text) to service_role;

-- Billable voice calls use server-authorized reservations. Reserving minutes
-- atomically prevents simultaneous calls from spending the same balance.
create table if not exists public.mss_voice_leases (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','settled')),
  reserved_monthly_ms bigint not null check (reserved_monthly_ms >= 0),
  reserved_topup_ms bigint not null check (reserved_topup_ms >= 0),
  reserved_total_ms bigint generated always as (reserved_monthly_ms + reserved_topup_ms) stored,
  consumed_ms bigint check (consumed_ms is null or consumed_ms >= 0),
  created_at timestamptz not null default now(),
  connection_deadline timestamptz not null,
  settled_at timestamptz
);
create unique index if not exists mss_single_active_voice_lease
  on public.mss_voice_leases (user_id) where status = 'active';
create index if not exists mss_voice_leases_user_created
  on public.mss_voice_leases (user_id, created_at desc);

alter table public.mss_voice_leases enable row level security;
revoke all on public.mss_voice_leases from anon, authenticated;
grant select on public.mss_voice_leases to authenticated;
drop policy if exists mss_voice_lease_owner_read on public.mss_voice_leases;
create policy mss_voice_lease_owner_read on public.mss_voice_leases
  for select to authenticated using ((select auth.uid()) = user_id);

-- Payment backend must call this function with a validated logged-in user.
-- A lease can reserve at most 5 minutes. All decisions are made while holding
-- the wallet row lock, giving predictable behaviour for simultaneous requests.
create or replace function public.mss_reserve_voice_lease(
  p_user_id uuid, p_lease_id uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_wallet public.mss_voice_wallets%rowtype;
  v_remaining_monthly bigint;
  v_remaining_topup bigint;
  v_total bigint;
  v_monthly bigint;
  v_topup bigint;
  v_expiry_cap bigint;
  v_stale public.mss_voice_leases%rowtype;
begin
  if p_user_id is null or p_lease_id is null then
    raise exception 'invalid_lease_identity';
  end if;
  -- Unknown accounts do not receive free voice credit.
  select * into v_wallet from public.mss_voice_wallets
    where user_id = p_user_id for update;
  if not found then raise exception 'no_voice_credits'; end if;

  -- A Render restart can interrupt settlement. Reclaim only leases that
  -- passed the server's absolute connection deadline, conservatively
  -- refunding all reserved minutes rather than charging for a crashed call.
  for v_stale in select * from public.mss_voice_leases
    where user_id = p_user_id and status = 'active'
      and connection_deadline < now() for update loop
    update public.mss_voice_leases set status='settled',
      consumed_ms=0, settled_at=now() where id=v_stale.id;
    update public.mss_voice_wallets set
      monthly_remaining_ms=monthly_remaining_ms +
        case when monthly_valid_until > now() then v_stale.reserved_monthly_ms else 0 end,
      topup_remaining_ms=topup_remaining_ms + v_stale.reserved_topup_ms,
      updated_at=now()
      where user_id=p_user_id;
  end loop;
  -- Refresh wallet after stale lease refunds.
  select * into v_wallet from public.mss_voice_wallets
    where user_id=p_user_id for update;
  if exists(select 1 from public.mss_voice_leases
    where user_id = p_user_id and status = 'active') then
    raise exception 'voice_session_already_active';
  end if;

  v_remaining_monthly := case when v_wallet.monthly_valid_until > now()
    then v_wallet.monthly_remaining_ms else 0 end;
  v_remaining_topup := v_wallet.topup_remaining_ms;
  v_total := least(300000::bigint, v_remaining_monthly + v_remaining_topup);
  if v_total <= 0 then raise exception 'no_voice_credits'; end if;
  -- Do not reserve monthly minutes beyond subscription expiration. Purchased
  -- top-ups remain spendable even after the Premium billing period expires.
  v_expiry_cap := case when v_remaining_monthly > 0 then greatest(0::bigint,
    floor(extract(epoch from (v_wallet.monthly_valid_until - now())) * 1000)::bigint)
    else 300000 end;
  if v_expiry_cap <= 0 then
    v_remaining_monthly := 0;
    v_total := least(300000::bigint, v_remaining_topup);
  else
    v_total := least(v_total, v_expiry_cap);
  end if;
  if v_total <= 0 then raise exception 'no_voice_credits'; end if;

  v_monthly := least(v_remaining_monthly, v_total);
  v_topup := v_total - v_monthly;
  update public.mss_voice_wallets set
    monthly_remaining_ms = case when monthly_valid_until > now()
      then monthly_remaining_ms - v_monthly else 0 end,
    topup_remaining_ms = topup_remaining_ms - v_topup,
    updated_at = now()
    where user_id = p_user_id;

  insert into public.mss_voice_leases
    (id, user_id, reserved_monthly_ms, reserved_topup_ms, connection_deadline)
    values (p_lease_id, p_user_id, v_monthly, v_topup, now() + interval '7 minutes');

  return jsonb_build_object('leaseId',p_lease_id,'reservedMs',v_total);
end $$;

-- Only the relay computes duration: never trust user-supplied audio clocks.
-- Replaying settlement is idempotent; refunded top-up minutes never expire.
create or replace function public.mss_settle_voice_lease(
  p_user_id uuid, p_lease_id uuid, p_elapsed_ms bigint
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_wallet public.mss_voice_wallets%rowtype;
  v_lease public.mss_voice_leases%rowtype;
  v_used bigint;
  v_unused_monthly bigint;
  v_unused_topup bigint;
  v_charged_monthly bigint;
begin
  if p_user_id is null or p_lease_id is null or p_elapsed_ms < 0 then
    raise exception 'invalid_lease_settlement';
  end if;
  select * into v_wallet from public.mss_voice_wallets where user_id=p_user_id for update;
  if not found then raise exception 'wallet_not_found'; end if;
  select * into v_lease from public.mss_voice_leases where user_id=p_user_id and id=p_lease_id for update;
  if not found then raise exception 'lease_not_found'; end if;
  if v_lease.status = 'settled' then
    return jsonb_build_object('settled',false,'alreadySettled',true,'chargedMs',v_lease.consumed_ms);
  end if;
  v_used := least(v_lease.reserved_total_ms,p_elapsed_ms);
  v_charged_monthly := least(v_lease.reserved_monthly_ms,v_used);
  v_unused_monthly := v_lease.reserved_monthly_ms - v_charged_monthly;
  v_unused_topup := v_lease.reserved_topup_ms -
    (v_used - v_charged_monthly);
  update public.mss_voice_wallets set
    monthly_remaining_ms = monthly_remaining_ms + case when monthly_valid_until > now()
      then v_unused_monthly else 0 end,
    topup_remaining_ms = topup_remaining_ms + v_unused_topup,
    updated_at = now()
    where user_id = p_user_id;
  update public.mss_voice_leases set
    status='settled',consumed_ms=v_used,settled_at=now()
    where id=p_lease_id;
  return jsonb_build_object('settled',true,'chargedMs',v_used);
end $$;
revoke all on function public.mss_reserve_voice_lease(uuid,uuid) from public, anon, authenticated;
revoke all on function public.mss_settle_voice_lease(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.mss_reserve_voice_lease(uuid,uuid) to service_role;
grant execute on function public.mss_settle_voice_lease(uuid,uuid,bigint) to service_role;

-- Seamless 5-minute reservation extension keeps a long conversation connected
-- while ensuring each additional interval is paid for before it is used.
create or replace function public.mss_extend_voice_lease(
  p_user_id uuid, p_lease_id uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_wallet public.mss_voice_wallets%rowtype;
  v_lease public.mss_voice_leases%rowtype;
  v_monthly_left bigint;
  v_topup_left bigint;
  v_increase bigint;
  v_monthly bigint;
  v_topup bigint;
  v_expiry_cap bigint;
begin
  select * into v_wallet from public.mss_voice_wallets
    where user_id=p_user_id for update;
  if not found then raise exception 'wallet_not_found'; end if;
  select * into v_lease from public.mss_voice_leases
    where id=p_lease_id and user_id=p_user_id for update;
  if not found or v_lease.status <> 'active' then
    raise exception 'lease_not_active';
  end if;
  v_monthly_left := case when v_wallet.monthly_valid_until > now()
    then v_wallet.monthly_remaining_ms else 0 end;
  v_topup_left := v_wallet.topup_remaining_ms;
  v_increase := least(300000::bigint, v_monthly_left + v_topup_left);
  if v_increase <= 0 then raise exception 'no_voice_credits'; end if;

  v_expiry_cap := case when v_monthly_left > 0
    then greatest(0::bigint,
      floor(extract(epoch from (v_wallet.monthly_valid_until - now())) * 1000)::bigint)
    else 300000 end;
  if v_expiry_cap <= 0 then
    v_monthly_left := 0;
    v_increase := least(300000::bigint, v_topup_left);
  else
    v_increase := least(v_increase,v_expiry_cap);
  end if;
  if v_increase < 1000 then raise exception 'no_voice_credits'; end if;

  v_monthly := least(v_increase,v_monthly_left);
  v_topup := v_increase - v_monthly;
  update public.mss_voice_wallets set
    monthly_remaining_ms = case when monthly_valid_until > now()
      then monthly_remaining_ms - v_monthly else 0 end,
    topup_remaining_ms = topup_remaining_ms - v_topup,
    updated_at = now()
    where user_id = p_user_id;
  update public.mss_voice_leases set
    reserved_monthly_ms = reserved_monthly_ms + v_monthly,
    reserved_topup_ms = reserved_topup_ms + v_topup,
    connection_deadline = now() + interval '7 minutes'
    where id=p_lease_id and user_id=p_user_id;
  return jsonb_build_object('reservedMs',v_lease.reserved_total_ms + v_increase);
end $$;

revoke all on function public.mss_extend_voice_lease(uuid,uuid) from public, anon, authenticated;
grant execute on function public.mss_extend_voice_lease(uuid,uuid) to service_role;
