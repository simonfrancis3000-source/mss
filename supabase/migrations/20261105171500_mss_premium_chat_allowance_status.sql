-- Read-only aggregate for the trusted backend's Premium chat hard cap.
-- No public grants: only the service-role caller can request an account's totals.
create or replace function public.mss_get_chat_allowance(p_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare
  v_start timestamptz; v_end timestamptz;
  v_cost numeric:=0; v_bonus numeric:=0; v_base numeric:=0.5;
  v_status text;
begin
 select e.status,coalesce(e.period_start,date_trunc('month',now())),e.valid_until
 into v_status,v_start,v_end
 from public.mss_subscription_entitlements e where e.user_id=p_user_id;
 select premium_limit_usd into v_base from public.mss_access_settings where id=1;
 v_base:=coalesce(v_base,0.5);
 if v_status not in ('active','canceled','grace','test') or
   v_end is null or v_end<=now() or v_start is null then
   return jsonb_build_object('limitUsd',v_base,'usedUsd',0,'bonusUsd',0,
     'remainingUsd',0,'hardStop',false,'periodStart',null,'periodEnd',null);
 end if;
 select coalesce(sum(e.estimated_cost_usd),0) into v_cost
 from public.mss_chat_cost_events e
 where e.user_id=p_user_id and e.created_at>=v_start and e.created_at<v_end;
 select coalesce(sum(g.bonus_usd),0) into v_bonus
 from public.mss_chat_bonus_grants g
 where g.user_id=p_user_id and g.period_start=v_start;
 return jsonb_build_object('limitUsd',v_base+v_bonus,'usedUsd',v_cost,
   'bonusUsd',v_bonus,'remainingUsd',greatest(0,v_base+v_bonus-v_cost),
   'hardStop',v_cost>=v_base+v_bonus,'periodStart',v_start,'periodEnd',v_end);
end $$;
revoke all on function public.mss_get_chat_allowance(uuid) from public,anon,authenticated;
grant execute on function public.mss_get_chat_allowance(uuid) to service_role;
