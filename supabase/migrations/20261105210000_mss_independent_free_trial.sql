-- Free-only $0.10 lifetime Chat allowance. Premium enforcement stays OFF.
-- Activation is a separate database toggle applied only after verification.
alter table public.mss_access_settings
  add column if not exists free_trial_enforcement_enabled boolean not null default false;

create or replace function public.mss_reserve_chat_request(
  p_user_id uuid, p_request_id uuid, p_kind text default 'chat'
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  v_recent integer; v_active integer; v_used numeric:=0; v_reserved numeric:=0;
  v_pending numeric:=0; v_trial_cap numeric; v_premium_cap numeric;
  v_mode text; v_ent record; v_enabled boolean; v_free_enabled boolean; v_bonus numeric:=0;
  v_period timestamptz; v_total numeric;
begin
  if p_user_id is null or p_request_id is null or
    p_kind not in ('chat','memory','knowledge','simulation','break_prompt','cognitive_delivery') then
    return jsonb_build_object('allowed',false,'code','invalid_request');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,92177));
  select enforcement_enabled,free_trial_enforcement_enabled,free_trial_limit_usd,premium_limit_usd
    into v_enabled,v_free_enabled,v_trial_cap,v_premium_cap
  from public.mss_access_settings where id=1;
  if v_enabled is null then
    return jsonb_build_object('allowed',false,'code','entitlement_unavailable');
  end if;
  select status,valid_until,period_start into v_ent
    from public.mss_subscription_entitlements where user_id=p_user_id;
  -- Any existing entitlement, including an expired or beta subscription,
  -- follows the existing (not yet enforced) Premium rules.
  if v_ent.status is not null then
    if not v_enabled then
      v_mode:='legacy';
    elsif v_ent.status in ('active','canceled','grace','test') and v_ent.valid_until>now() then
      if v_ent.period_start is null then
        return jsonb_build_object('allowed',false,'code','entitlement_unavailable');
      end if;
      v_mode:='premium';
    else
      return jsonb_build_object('allowed',false,'code','subscription_required');
    end if;
  elsif v_enabled or v_free_enabled then
    v_mode:='trial';
  else
    v_mode:='legacy';
  end if;
  select count(*) into v_recent from public.mss_chat_request_slots
  where user_id=p_user_id and created_at>now()-interval '1 minute'
    and kind in ('chat','memory','knowledge','simulation','break_prompt','cognitive_delivery');
  if v_recent>=12 then return jsonb_build_object('allowed',false,'code','rate_limited'); end if;
  select count(*) into v_active from public.mss_chat_request_slots
    where user_id=p_user_id and released_at is null and expires_at>now();
  if v_active>=2 then return jsonb_build_object('allowed',false,'code','concurrent_limit'); end if;

  if v_mode='trial' then
    if p_kind not in ('chat','memory','knowledge') then
      return jsonb_build_object('allowed',false,'code','premium_required_for_feature');
    end if;
    select coalesce(used_usd,0) into v_used from public.mss_free_chat_usage where user_id=p_user_id;
    v_used:=coalesce(v_used,0);
    select coalesce(sum(reserved_cost_usd),0) into v_pending from public.mss_chat_request_slots
      where user_id=p_user_id and mode='trial' and released_at is null and expires_at>now();
    v_total:=v_trial_cap;
    if v_used+v_pending>=v_total then
      return jsonb_build_object('allowed',false,'code','free_trial_exhausted');
    end if;
    v_reserved:=least(0.0100,greatest(0,v_total-v_used-v_pending));
  elsif v_mode='premium' then
    v_period:=v_ent.period_start;
    select coalesce(sum(estimated_cost_usd),0) into v_used from public.mss_chat_cost_events
      where user_id=p_user_id and billing_period_start=v_period;
    select coalesce(sum(bonus_usd),0) into v_bonus from public.mss_chat_bonus_grants
      where user_id=p_user_id and period_start=v_period;
    select coalesce(sum(reserved_cost_usd),0) into v_pending from public.mss_chat_request_slots
      where user_id=p_user_id and mode='premium' and billing_period_start=v_period
        and released_at is null and expires_at>now();
    v_total:=v_premium_cap+v_bonus;
    if v_used+v_pending>=v_total then
      return jsonb_build_object('allowed',false,'code','premium_chat_exhausted',
        'spentUsd',v_used,'limitUsd',v_total);
    end if;
    v_reserved:=least(0.0100,greatest(0,v_total-v_used-v_pending));
  end if;
  insert into public.mss_chat_request_slots(
    request_id,user_id,kind,mode,billing_period_start,reserved_cost_usd
  ) values(p_request_id,p_user_id,p_kind,v_mode,v_period,v_reserved);
  return jsonb_build_object('allowed',true,'mode',v_mode,
    'remainingUsd',case when v_mode in ('trial','premium')
      then greatest(0,v_total-v_used-v_pending) else null end);
end $$;
revoke all on function public.mss_reserve_chat_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mss_reserve_chat_request(uuid,uuid,text) to service_role;

create or replace function mss_internal.training_allowed()
returns boolean language sql stable security definer set search_path=''
as $$
  select
  (
    exists (select 1 from public.mss_subscription_entitlements e
      where e.user_id=auth.uid())
    and
    (
      not coalesce((select s.enforcement_enabled
          from public.mss_access_settings s where s.id=1),false)
      or exists (
        select 1 from public.mss_subscription_entitlements e
        where e.user_id=auth.uid()
          and e.status in ('active','canceled','grace','test')
          and e.valid_until>now()
          and e.period_start is not null
          and coalesce((
              select sum(c.estimated_cost_usd)
              from public.mss_chat_cost_events c
              where c.user_id=e.user_id
                and c.billing_period_start=e.period_start
          ),0) <
          coalesce((select s.premium_limit_usd
             from public.mss_access_settings s where s.id=1),0.50)
          + coalesce((
              select sum(g.bonus_usd)
              from public.mss_chat_bonus_grants g
              where g.user_id=e.user_id
                and g.period_start=e.period_start
          ),0)
      )
    )
  )
  or
  (
    not exists (select 1 from public.mss_subscription_entitlements e
      where e.user_id=auth.uid())
    and (
      not coalesce((
        select s.enforcement_enabled or s.free_trial_enforcement_enabled
        from public.mss_access_settings s where s.id=1
      ),false)
      or coalesce((select u.used_usd from public.mss_free_chat_usage u
          where u.user_id=auth.uid()),0)
         < coalesce((select s.free_trial_limit_usd
             from public.mss_access_settings s where s.id=1),0.10)
    )
  );
$$;
revoke all on function mss_internal.training_allowed() from public,anon;
grant execute on function mss_internal.training_allowed() to authenticated,service_role;
