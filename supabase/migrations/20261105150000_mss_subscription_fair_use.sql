-- MSS Premium entitlements and fair-use controls. All enforcement starts disabled.
create schema if not exists mss_internal;
revoke all on schema mss_internal from public, anon;
grant usage on schema mss_internal to authenticated, service_role;

create table if not exists public.mss_subscription_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'google_play' check (provider in ('google_play','beta')),
  status text not null default 'expired' check (status in ('active','canceled','grace','hold','expired','revoked','test')),
  purchase_token_hash text unique,
  period_start timestamptz,
  valid_until timestamptz,
  last_verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mss_subscriptions_active_idx on public.mss_subscription_entitlements(valid_until);
alter table public.mss_subscription_entitlements enable row level security;
revoke all on public.mss_subscription_entitlements from public, anon, authenticated;
grant select on public.mss_subscription_entitlements to authenticated;
grant all on public.mss_subscription_entitlements to service_role;
create policy mss_subscription_owner_read on public.mss_subscription_entitlements
  for select to authenticated using ((select auth.uid())=user_id);

create table if not exists public.mss_access_settings (
  id smallint primary key default 1 check (id=1),
  enforcement_enabled boolean not null default false,
  review_threshold_usd numeric(8,4) not null default 1.0000 check (review_threshold_usd>0),
  free_trial_limit_usd numeric(8,4) not null default 0.1000 check (free_trial_limit_usd>0),
  updated_at timestamptz not null default now()
);
insert into public.mss_access_settings(id,enforcement_enabled,review_threshold_usd,free_trial_limit_usd)
values (1,false,1.0000,0.1000) on conflict(id) do nothing;
alter table public.mss_access_settings enable row level security;
revoke all on public.mss_access_settings from public, anon, authenticated;
grant all on public.mss_access_settings to service_role;

-- One-time $0.10 allowance, never reset and never reissued following subscription.
create table if not exists public.mss_free_chat_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_usd numeric(14,8) not null default 0 check (used_usd >= 0),
  updated_at timestamptz not null default now()
);
alter table public.mss_free_chat_usage enable row level security;
revoke all on public.mss_free_chat_usage from public, anon, authenticated;
grant select on public.mss_free_chat_usage to authenticated;
grant all on public.mss_free_chat_usage to service_role;
create policy mss_free_chat_usage_owner_read on public.mss_free_chat_usage
 for select to authenticated using ((select auth.uid())=user_id);

-- Kept outside the exposed API. The invoker cannot choose a different user ID.
create or replace function mss_internal.training_allowed()
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce((select not s.enforcement_enabled from public.mss_access_settings s where s.id=1),false)
  or exists (
    select 1 from public.mss_subscription_entitlements e
    where e.user_id=(select auth.uid())
      and e.status in ('active','canceled','grace','test')
      and e.valid_until>now()
  )
  or (
    not exists (select 1 from public.mss_subscription_entitlements e where e.user_id=(select auth.uid()))
    and coalesce((select u.used_usd from public.mss_free_chat_usage u where u.user_id=(select auth.uid())),0)
         < coalesce((select s.free_trial_limit_usd from public.mss_access_settings s where s.id=1),0.10)
  );
$;
revoke all on function mss_internal.training_allowed() from public,anon;
grant execute on function mss_internal.training_allowed() to authenticated,service_role;

-- Restrictive write policies are ANDed with the existing owner policies.
-- Select and deletion remain available after an account expires.
do $$
declare t text;
begin
  foreach t in array array[
    'synqme_conversations','synqme_preferences','synqme_memory_index',
    'synqme_persona_memories','synqme_room_journeys','synqme_reminders',
    'synqme_appliance_references','synqme_decision_states',
    'synqme_evaluation_records','synqme_training_revisions','synqme_memory_jobs',
    'synqme_knowledge_candidates'
  ] loop
    execute format('create policy mss_active_training_insert on public.%I as restrictive for insert to authenticated with check (mss_internal.training_allowed())',t);
    execute format('create policy mss_active_training_update on public.%I as restrictive for update to authenticated using (mss_internal.training_allowed()) with check (mss_internal.training_allowed())',t);
  end loop;
end $$;

create table if not exists public.mss_chat_request_slots (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '3 minutes',
  released_at timestamptz,
  kind text not null default 'chat',
  mode text not null default 'premium',
  reserved_cost_usd numeric(14,8) not null default 0
);
create index if not exists mss_chat_slots_user_time_idx
on public.mss_chat_request_slots(user_id,created_at desc);
alter table public.mss_chat_request_slots enable row level security;
revoke all on public.mss_chat_request_slots from public,anon,authenticated;
grant all on public.mss_chat_request_slots to service_role;

create or replace function public.mss_reserve_chat_request(p_user_id uuid,p_request_id uuid,p_kind text default 'chat')
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_minute integer; v_active integer; v_used numeric; v_inflight numeric; v_trial_max numeric;
        v_mode text; v_ent record; v_enabled boolean; v_reserved numeric;
begin
 if p_user_id is null or p_request_id is null or p_kind not in
  ('chat','memory','knowledge','simulation','break_prompt','cognitive_delivery') then
    return jsonb_build_object('allowed',false,'code','invalid_request');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,92177));
 select enforcement_enabled, free_trial_limit_usd into v_enabled, v_trial_max
 from public.mss_access_settings where id=1;
 if v_enabled is null then return jsonb_build_object('allowed',false,'code','entitlement_unavailable'); end if;

 select status, valid_until into v_ent
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

 v_reserved:=0;
 if v_mode='trial' then
   if p_kind not in ('chat','memory','knowledge') then
     return jsonb_build_object('allowed',false,'code','premium_required_for_feature');
   end if;
   select coalesce(used_usd,0) into v_used from public.mss_free_chat_usage where user_id=p_user_id;
   v_used:=coalesce(v_used,0);
   select coalesce(sum(reserved_cost_usd),0) into v_inflight from public.mss_chat_request_slots
     where user_id=p_user_id and mode='trial' and released_at is null and expires_at>now();
   if v_used+v_inflight>=v_trial_max then
     return jsonb_build_object('allowed',false,'code','free_trial_exhausted');
   end if;
   v_reserved:=least(0.0100, greatest(0,v_trial_max-v_used-v_inflight));
 end if;
 insert into public.mss_chat_request_slots(request_id,user_id,kind,mode,reserved_cost_usd)
 values(p_request_id,p_user_id,p_kind,v_mode,v_reserved);
 return jsonb_build_object('allowed',true,'code','ok','mode',v_mode,'remainingUsd',
   case when v_mode='trial' then greatest(0,v_trial_max-coalesce(v_used,0)-coalesce(v_inflight,0)) else null end);
end $$;
revoke all on function public.mss_reserve_chat_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mss_reserve_chat_request(uuid,uuid,text) to service_role;

create or replace function public.mss_release_chat_request(p_user_id uuid,p_request_id uuid)
returns void language sql security invoker set search_path=''
as $$
 update public.mss_chat_request_slots set released_at=now()
 where user_id=p_user_id and request_id=p_request_id and released_at is null;
$$;
revoke all on function public.mss_release_chat_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mss_release_chat_request(uuid,uuid) to service_role;

-- Only the trusted API writes these cost events, not mobile/web clients.
create table if not exists public.mss_chat_cost_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid,
  operation text not null,
  estimated_cost_usd numeric(14,8) not null check (estimated_cost_usd>=0),
  created_at timestamptz not null default now()
);
create index if not exists mss_chat_cost_user_time on public.mss_chat_cost_events(user_id,created_at desc);
alter table public.mss_chat_cost_events enable row level security;
revoke all on public.mss_chat_cost_events from public,anon,authenticated;
grant all on public.mss_chat_cost_events to service_role;

create table if not exists public.mss_chat_cost_reviews (
 user_id uuid not null references auth.users(id) on delete cascade,
 period_start timestamptz not null,
 period_end timestamptz not null,
 estimated_cost_usd numeric(14,8) not null default 0,
 flagged_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key (user_id,period_start)
);
alter table public.mss_chat_cost_reviews enable row level security;
revoke all on public.mss_chat_cost_reviews from public,anon,authenticated;
grant all on public.mss_chat_cost_reviews to service_role;

create or replace function public.mss_refresh_chat_cost_review(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_start timestamptz; v_end timestamptz; v_cost numeric; v_threshold numeric; v_flagged boolean;
begin
 select coalesce(e.period_start,date_trunc('month',now())),coalesce(e.valid_until,date_trunc('month',now())+interval '1 month')
 into v_start,v_end from public.mss_subscription_entitlements e where e.user_id=p_user_id;
 if v_start is null or v_start>now() or v_end<=v_start then
   v_start:=date_trunc('month',now()); v_end:=v_start+interval '1 month';
 end if;
 select coalesce(sum(estimated_cost_usd),0) into v_cost from public.mss_chat_cost_events
 where user_id=p_user_id and created_at>=v_start and created_at<v_end;
 select review_threshold_usd into v_threshold from public.mss_access_settings where id=1;
 v_flagged:=v_cost>=coalesce(v_threshold,1);
 insert into public.mss_chat_cost_reviews(user_id,period_start,period_end,estimated_cost_usd,flagged_at)
 values(p_user_id,v_start,v_end,v_cost,case when v_flagged then now() else null end)
 on conflict(user_id,period_start) do update set
  estimated_cost_usd=excluded.estimated_cost_usd,
  period_end=excluded.period_end,
  flagged_at=case when excluded.flagged_at is not null then
    coalesce(public.mss_chat_cost_reviews.flagged_at,excluded.flagged_at)
    else public.mss_chat_cost_reviews.flagged_at end,
  updated_at=now();
 return jsonb_build_object('estimatedCostUsd',v_cost,'reviewRequired',v_flagged,'thresholdUsd',coalesce(v_threshold,1));
end $$;
revoke all on function public.mss_refresh_chat_cost_review(uuid) from public,anon,authenticated;
grant execute on function public.mss_refresh_chat_cost_review(uuid) to service_role;

-- Cost settlements are trusted server-to-database writes only; associated
-- DeepSeek processing (memory, continuity, repairs) is included in the trial.
create or replace function public.mss_record_chat_cost(
 p_user_id uuid,p_request_id uuid,p_operation text,p_cost_usd numeric
)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_mode text; v_used numeric; v_cap numeric; v_review jsonb;
begin
 if p_user_id is null or p_request_id is null or p_cost_usd is null
  or p_cost_usd<0 or p_cost_usd>1 or length(coalesce(p_operation,''))>80 then
   raise exception 'invalid_chat_cost';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,92177));
 select mode into v_mode from public.mss_chat_request_slots
  where user_id=p_user_id and request_id=p_request_id;
 if v_mode is null then raise exception 'unreserved_chat_cost'; end if;
 insert into public.mss_chat_cost_events(user_id,request_id,operation,estimated_cost_usd)
 values (p_user_id,p_request_id,p_operation,p_cost_usd);
 if v_mode='trial' then
    insert into public.mss_free_chat_usage(user_id,used_usd)
    values(p_user_id,p_cost_usd)
    on conflict(user_id) do update set
      used_usd=public.mss_free_chat_usage.used_usd+excluded.used_usd,
      updated_at=now();
    select used_usd into v_used from public.mss_free_chat_usage where user_id=p_user_id;
    select free_trial_limit_usd into v_cap from public.mss_access_settings where id=1;
    return jsonb_build_object('mode','trial','remainingUsd',greatest(0,v_cap-v_used));
 end if;
 if v_mode='premium' then
    v_review:=public.mss_refresh_chat_cost_review(p_user_id);
    return v_review;
 end if;
 return jsonb_build_object('mode',v_mode);
end $$;
revoke all on function public.mss_record_chat_cost(uuid,uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.mss_record_chat_cost(uuid,uuid,text,numeric) to service_role;
