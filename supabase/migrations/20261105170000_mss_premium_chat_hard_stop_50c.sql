-- Premium's $0.50 estimated DeepSeek usage limit is a hard chat stop.
-- A verified voice-minute pack adds a further $0.50 chat allowance during the
-- same subscription period. Free users retain a one-time $0.10 chat trial.
-- A dedicated feature flag and the global enforcement switch remain OFF.
alter table public.mss_access_settings
  add column if not exists premium_limit_usd numeric(8,4)
    not null default 0.5000 check (premium_limit_usd > 0);
update public.mss_access_settings
  set review_threshold_usd=0.5000,premium_limit_usd=0.5000,updated_at=now()
  where id=1;

create table if not exists public.mss_chat_bonus_grants (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  product_id text not null check (product_id in ('mss_voice_60','mss_voice_120','mss_voice_300','mss_voice_600')),
  bonus_usd numeric(8,4) not null default 0.5000 check (bonus_usd > 0),
  created_at timestamptz not null default now()
);
create index if not exists mss_chat_bonus_user_period
  on public.mss_chat_bonus_grants(user_id,period_start);
alter table public.mss_chat_bonus_grants enable row level security;
revoke all on public.mss_chat_bonus_grants from public, anon, authenticated;
grant all on public.mss_chat_bonus_grants to service_role;

-- Do not reset the once-only free trial when Premium begins, lapses or renews.
-- The chat cap is checked transactionally in the server-only reservation RPC.
create or replace function public.mss_reserve_chat_request(
  p_user_id uuid,p_request_id uuid,p_kind text default 'chat'
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  v_minute integer; v_active integer; v_used numeric:=0;
  v_inflight numeric:=0; v_trial_max numeric; v_base numeric;
  v_mode text; v_ent record; v_enabled boolean; v_reserved numeric:=0;
  v_period_start timestamptz; v_period_end timestamptz; v_bonus numeric:=0;
  v_allowance numeric;
begin
 if p_user_id is null or p_request_id is null or p_kind not in
  ('chat','memory','knowledge','simulation','break_prompt','cognitive_delivery') then
   return jsonb_build_object('allowed',false,'code','invalid_request');
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,92177));
 select enforcement_enabled,free_trial_limit_usd,premium_limit_usd
   into v_enabled,v_trial_max,v_base from public.mss_access_settings where id=1;
 if v_enabled is null then
   return jsonb_build_object('allowed',false,'code','entitlement_unavailable');
 end if;
 select status,valid_until,period_start into v_ent
   from public.mss_subscription_entitlements where user_id=p_user_id;
 if not v_enabled then
   v_mode:='legacy';
 elsif v_ent.status in ('active','canceled','grace','test') and v_ent.valid_until>now() then
   v_mode:='premium';
 elsif v_ent.status is not null then
   return jsonb_build_object('allowed',false,'code','subscription_required');
 else
   v_mode:='trial';
 end if;

 select count(*) into v_minute from public.mss_chat_request_slots
  where user_id=p_user_id and kind in ('chat','memory','knowledge','simulation','break_prompt')
    and created_at>now()-interval '1 minute';
 if v_minute>=12 then return jsonb_build_object('allowed',false,'code','rate_limited'); end if;
 select count(*) into v_active from public.mss_chat_request_slots
  where user_id=p_user_id and released_at is null and expires_at>now();
 if v_active>=2 then return jsonb_build_object('allowed',false,'code','concurrent_limit'); end if;

 if v_mode='trial' then
   if p_kind not in ('chat','memory','knowledge') then
      return jsonb_build_object('allowed',false,'code','premium_required_for_feature');
   end if;
   select coalesce(used_usd,0) into v_used from public.mss_free_chat_usage where user_id=p_user_id;
   v_used:=coalesce(v_used,0);
   select coalesce(sum(reserved_cost_usd),0) into v_inflight from public.mss_chat_request_slots
     where user_id=p_user_id and mode='trial' and released_at is null and expires_at>now();
   v_allowance:=v_trial_max;
   if v_used+v_inflight>=v_allowance then
      return jsonb_build_object('allowed',false,'code','free_trial_exhausted');
   end if;
   v_reserved:=least(0.0100,greatest(0,v_allowance-v_used-v_inflight));
 elsif v_mode='premium' then
   v_period_start:=coalesce(v_ent.period_start,date_trunc('month',now()));
   v_period_end:=v_ent.valid_until;
   select coalesce(sum(estimated_cost_usd),0) into v_used
     from public.mss_chat_cost_events
     where user_id=p_user_id
       and created_at>=v_period_start and created_at<v_period_end;
   select coalesce(sum(bonus_usd),0) into v_bonus
     from public.mss_chat_bonus_grants
     where user_id=p_user_id and period_start=v_period_start;
   select coalesce(sum(reserved_cost_usd),0) into v_inflight
     from public.mss_chat_request_slots where user_id=p_user_id and mode='premium'
       and released_at is null and expires_at>now();
   v_allowance:=v_base+v_bonus;
   if v_used+v_inflight>=v_allowance then
      return jsonb_build_object('allowed',false,'code','premium_chat_exhausted',
        'spentUsd',v_used,'limitUsd',v_allowance);
   end if;
   v_reserved:=least(0.0100,greatest(0,v_allowance-v_used-v_inflight));
 end if;
 insert into public.mss_chat_request_slots(request_id,user_id,kind,mode,reserved_cost_usd)
 values(p_request_id,p_user_id,p_kind,v_mode,v_reserved);
 return jsonb_build_object('allowed',true,'code','ok','mode',v_mode,
   'remainingUsd',case when v_mode in ('trial','premium')
     then greatest(0,v_allowance-v_used-v_inflight) else null end);
end $$;
revoke all on function public.mss_reserve_chat_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mss_reserve_chat_request(uuid,uuid,text) to service_role;

-- Dynamic current-period tally is authoritative; do not rely on client events.
create or replace function public.mss_refresh_chat_cost_review(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_start timestamptz; v_end timestamptz; v_cost numeric;
        v_base numeric; v_bonus numeric; v_cap numeric; v_flagged boolean;
begin
 select coalesce(e.period_start,date_trunc('month',now())),
        coalesce(e.valid_until,date_trunc('month',now())+interval '1 month')
 into v_start,v_end from public.mss_subscription_entitlements e
 where e.user_id=p_user_id;
 if v_start is null or v_start>now() or v_end<=v_start then
   v_start:=date_trunc('month',now());v_end:=v_start+interval '1 month';
 end if;
 select coalesce(sum(estimated_cost_usd),0) into v_cost from public.mss_chat_cost_events
 where user_id=p_user_id and created_at>=v_start and created_at<v_end;
 select premium_limit_usd into v_base from public.mss_access_settings where id=1;
 select coalesce(sum(bonus_usd),0) into v_bonus from public.mss_chat_bonus_grants
 where user_id=p_user_id and period_start=v_start;
 v_cap:=coalesce(v_base,0.50)+v_bonus;
 v_flagged:=v_cost>=v_cap;
 insert into public.mss_chat_cost_reviews(
  user_id,period_start,period_end,estimated_cost_usd,flagged_at
 ) values(p_user_id,v_start,v_end,v_cost,case when v_flagged then now() else null end)
 on conflict(user_id,period_start) do update set
   estimated_cost_usd=excluded.estimated_cost_usd,
   period_end=excluded.period_end,
   flagged_at=case when excluded.flagged_at is not null
     then coalesce(public.mss_chat_cost_reviews.flagged_at,excluded.flagged_at)
     else public.mss_chat_cost_reviews.flagged_at end,
   updated_at=now();
 return jsonb_build_object('estimatedCostUsd',v_cost,'hardStop',v_flagged,
   'limitUsd',v_cap,'remainingUsd',greatest(0,v_cap-v_cost),'bonusUsd',v_bonus);
end $$;
revoke all on function public.mss_refresh_chat_cost_review(uuid) from public,anon,authenticated;
grant execute on function public.mss_refresh_chat_cost_review(uuid) to service_role;
