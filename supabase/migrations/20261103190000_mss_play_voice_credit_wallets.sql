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
