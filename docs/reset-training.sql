create table public.synqme_training_revisions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 0
);
alter table public.synqme_training_revisions enable row level security;
grant select,insert,update on public.synqme_training_revisions to authenticated;
create policy account_owner on public.synqme_training_revisions for all to authenticated using ((select auth.uid())=user_id and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false) with check ((select auth.uid())=user_id and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);
alter table public.synqme_memory_index add column scenario_id text;
create function public.synqme_check_training_revision() returns trigger language plpgsql security invoker set search_path='' as $$
declare expected bigint; supplied text;
begin
 select revision into expected from public.synqme_training_revisions where user_id=auth.uid() for share;
 supplied := current_setting('request.headers',true)::jsonb->>'x-training-revision';
 if coalesce(expected,0)>0 and supplied is distinct from expected::text then raise exception 'Training changed in another session. Reload SYNQ.ME before continuing.' using errcode='40001'; end if;
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
create trigger check_training_revision before insert or update or delete on public.synqme_conversations for each row execute function public.synqme_check_training_revision();
create trigger check_training_revision before insert or update or delete on public.synqme_preferences for each row execute function public.synqme_check_training_revision();
create trigger check_training_revision before insert or update or delete on public.synqme_memory_index for each row execute function public.synqme_check_training_revision();
create trigger check_training_revision before insert or update or delete on public.synqme_persona_memories for each row execute function public.synqme_check_training_revision();
create trigger check_training_revision before insert or update or delete on public.synqme_decision_states for each row execute function public.synqme_check_training_revision();
create trigger check_training_revision before insert or update or delete on public.synqme_appliance_references for each row execute function public.synqme_check_training_revision();
create trigger check_training_revision before insert or update or delete on public.synqme_evaluation_records for each row execute function public.synqme_check_training_revision();
create trigger check_training_revision before insert or update or delete on public.synqme_room_journeys for each row execute function public.synqme_check_training_revision();
create function public.synqme_reset_training(p_confirmation text, p_scenario_id text default null)
returns bigint language plpgsql security invoker set search_path='' as $$
declare owner_id uuid := auth.uid(); rev bigint; transcript jsonb; item jsonb; tagged jsonb := '[]'; current_scope text; inferred text; stamps text[] := '{}'; contents text[] := '{}'; memory_ids uuid[]; pref_ids text[]; journey jsonb; done jsonb;
begin
 if owner_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in to reset training.'; end if;
 if p_confirmation is distinct from 'RESET' then raise exception 'Type RESET exactly to confirm.'; end if;
 if p_scenario_id is not null and p_scenario_id not in (
 'room:kitchen','room:living_room','room:bathroom','room:bedroom','room:laundry_utility','room:hallway_entry','room:dining_room','room:home_office','room:garden_outdoor','room:garage_storage','room:guest_room','room:balcony_patio',
 'outside:strangers:adult-approaches','outside:strangers:child-approaches','outside:known-people:owner-introduction','outside:public-mobility:sidewalk','outside:public-mobility:crowded-street','outside:shops-services:cafe-order','outside:social-intelligence:private-conversation','outside:work-community:business-meeting','outside:animals:dog-greeting','outside:public-safety:separated','outside:public-safety:owner-falls','outside:advanced-context:upset-person','outside:strangers:home-address') then raise exception 'Choose a valid scenario.'; end if;
 insert into public.synqme_training_revisions(user_id) values(owner_id) on conflict do nothing;
 select revision into rev from public.synqme_training_revisions where user_id=owner_id for update;
 if rev>0 and (current_setting('request.headers',true)::jsonb->>'x-training-revision') is distinct from rev::text then raise exception 'Reload SYNQ.ME before resetting training.'; end if;
 select messages into transcript from public.synqme_conversations where user_id=owner_id for update;
 if p_scenario_id is not null then
  for item in select value from jsonb_array_elements(coalesce(transcript,'[]')) loop
   inferred := item->>'scenario_id';
   if inferred is null and item->>'role'='user' then
    select case when e.scope_key like 'room:%' then split_part(e.scope_key,':',1)||':'||split_part(e.scope_key,':',2) else e.scope_key end into inferred
    from public.synqme_evaluation_records e, lateral jsonb_array_elements(e.source_refs) r
    where e.user_id=owner_id and r->>'in_reply_to_user_timestamp'=item->>'timestamp' limit 1;
   end if;
   if item->>'role'='user' then current_scope:=inferred; end if;
   inferred:=coalesce(inferred,current_scope);
   if inferred is not null then item:=item||jsonb_build_object('scenario_id',inferred); end if;
   tagged:=tagged||jsonb_build_array(item);
   if inferred=p_scenario_id then stamps:=array_append(stamps,item->>'timestamp'); contents:=array_append(contents,item->>'content'); end if;
  end loop;
  if exists(select 1 from public.synqme_preferences p where p.user_id=owner_id and not exists(select 1 from jsonb_array_elements(tagged) m where m->>'scenario_id' is not null and m->>'content'=p.source_message) and not exists(select 1 from public.synqme_persona_memories m where m.user_id=owner_id and m.source_preference_id=p.id::text and m.attributes->>'scenario_id' is not null))
   or exists(select 1 from public.synqme_appliance_references a where a.user_id=owner_id and a.source_memory_id is null) then raise exception 'Some older learning has no reliable scenario source. Nothing was deleted. Use reset all training to clear it completely.'; end if;
  -- Legacy data is never assigned by keyword or guessed from the selected room.
  if exists(select 1 from public.synqme_memory_index i where i.user_id=owner_id and i.scenario_id is null and not exists(select 1 from jsonb_array_elements(tagged) m where (m->>'timestamp')::timestamptz=i.message_timestamp and m->>'scenario_id' is not null))
    or exists(select 1 from jsonb_array_elements(tagged) m where m->>'role'='user' and m->>'scenario_id' is null)
    or exists(select 1 from public.synqme_persona_memories m where m.user_id=owner_id and m.attributes->>'scenario_id' is null and not exists(select 1 from jsonb_array_elements(tagged) t where (t->>'timestamp')::timestamptz=m.source_timestamp and t->>'scenario_id' is not null)) then
   raise exception 'Older training cannot be reliably separated by scenario. Nothing was deleted. Reset all training to clear it completely.';
  end if;
  if exists(select 1 from jsonb_array_elements(tagged) m where m->>'scenario_id' is distinct from p_scenario_id and m->>'content'=any(contents)) then raise exception 'Some older training sources are shared across scenarios. Nothing was deleted. Use reset all training to clear them completely.'; end if;
  select array_agg(id),array_agg(source_preference_id) into memory_ids,pref_ids from public.synqme_persona_memories where user_id=owner_id and (attributes->>'scenario_id'=p_scenario_id or source_timestamp in(select (v)::timestamptz from unnest(stamps) v));
  delete from public.synqme_appliance_references where user_id=owner_id and source_memory_id=any(coalesce(memory_ids,'{}'));
  delete from public.synqme_decision_states where user_id=owner_id and (scope_key=p_scenario_id or starts_with(scope_key,p_scenario_id||':') or source_memory_id=any(coalesce(memory_ids,'{}')));
  delete from public.synqme_evaluation_records where user_id=owner_id and (scope_key=p_scenario_id or starts_with(scope_key,p_scenario_id||':'));
  delete from public.synqme_persona_memories where user_id=owner_id and id=any(coalesce(memory_ids,'{}'));
  delete from public.synqme_preferences where user_id=owner_id and (id::text=any(coalesce(pref_ids,'{}')) or source_message=any(contents));
  delete from public.synqme_memory_index where user_id=owner_id and (scenario_id=p_scenario_id or message_timestamp in(select v::timestamptz from unnest(stamps) v));
  update public.synqme_conversations set messages=coalesce((select jsonb_agg(m) from jsonb_array_elements(tagged) m where m->>'scenario_id' is distinct from p_scenario_id),'[]'),pending_clarification=null,updated_at=now() where user_id=owner_id;
  select room_progress into journey from public.synqme_room_journeys where user_id=owner_id for update;
  select coalesce(jsonb_agg(v),'[]') into done from jsonb_array_elements(coalesce(journey#>'{scenario_journey_v1,completed}','[]')) v where v#>>'{}'<>p_scenario_id;
  journey:=jsonb_set(coalesce(journey,'{}'),'{scenario_journey_v1}',coalesce(journey->'scenario_journey_v1','{}')||jsonb_build_object('completed',done,'started',p_scenario_id,'startedAt',now(),'reviewed',coalesce(journey#>'{scenario_journey_v1,reviewed}','{}')-p_scenario_id));
  if p_scenario_id like 'room:%' then journey:=journey-split_part(p_scenario_id,':',2); end if;
  update public.synqme_room_journeys set room_progress=journey,active_task_id=null,active_room_id=case when p_scenario_id like 'room:%' then split_part(p_scenario_id,':',2) else active_room_id end,updated_at=now() where user_id=owner_id;
 else
  delete from public.synqme_appliance_references where user_id=owner_id;
  delete from public.synqme_decision_states where user_id=owner_id;
  delete from public.synqme_evaluation_records where user_id=owner_id;
  delete from public.synqme_persona_memories where user_id=owner_id;
  delete from public.synqme_preferences where user_id=owner_id;
  delete from public.synqme_memory_index where user_id=owner_id;
  update public.synqme_conversations set messages='[]',pending_clarification=null,updated_at=now() where user_id=owner_id;
  update public.synqme_room_journeys set room_progress='{}',active_room_id='kitchen',active_task_id=null,journey_started_at=now(),updated_at=now() where user_id=owner_id;
 end if;
 delete from public.synqme_knowledge_candidates where user_id=owner_id and status='pending_review';
 update public.synqme_training_revisions set revision=rev+1 where user_id=owner_id;
 return rev+1;
end $$;
revoke all on function public.synqme_reset_training(text,text) from public,anon;
grant execute on function public.synqme_reset_training(text,text) to authenticated;
revoke all on function public.synqme_check_training_revision() from public,anon;
