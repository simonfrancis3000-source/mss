-- Durable runtime enrichment reuses the existing memory queue and persona rules.
alter table public.synqme_memory_jobs
 add column server_owned boolean not null default false,
 add column runtime_revision bigint,
 add column proposals jsonb not null default '[]' check(jsonb_typeof(proposals)='array' and jsonb_array_length(proposals)<=8 and octet_length(proposals::text)<=32768),
 add column last_error text check(length(last_error)<=100);
create index cognitive_memory_ready on public.synqme_memory_jobs(available_at,created_at) where server_owned and status<>'done';
grant all on public.synqme_memory_jobs to service_role;
alter policy memory_jobs_owner on public.synqme_memory_jobs
 using ((select auth.uid())=user_id and not server_owned and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true')
 with check ((select auth.uid())=user_id and not server_owned and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true');
create policy cognitive_jobs_read on public.synqme_memory_jobs for select to authenticated
 using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true');
create policy cognitive_jobs_reset on public.synqme_memory_jobs for delete to authenticated
 using ((select auth.uid())=user_id and server_owned and runtime_revision<(select revision from public.synqme_training_revisions where user_id=(select auth.uid())));
create or replace function public.synqme_claim_memory_job() returns setof public.synqme_memory_jobs
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Registered account required' using errcode='42501'; end if;
 return query with candidate as (
  select id from public.synqme_memory_jobs where user_id=auth.uid() and not server_owned
  and ((status='pending' and available_at<=now()) or (status='processing' and lease_until<now())) order by created_at for update skip locked limit 1
 ) update public.synqme_memory_jobs j set status='processing',attempts=attempts+1,lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid(),updated_at=now()
 from candidate c where j.id=c.id returning j.*;
end $$;

create table public.synqme_rule_relations (
 user_id uuid not null references auth.users(id) on delete cascade,
 from_rule_id uuid not null, to_rule_id uuid not null,
 relation text not null check(relation in ('depends_on','exception_to','conflicts_with','supersedes')),
 source_refs jsonb not null default '[]' check(jsonb_typeof(source_refs)='array' and octet_length(source_refs::text)<=4096),
 created_at timestamptz not null default now(),
 primary key(user_id,from_rule_id,to_rule_id,relation),
 foreign key(user_id,from_rule_id) references public.synqme_persona_memories(user_id,id) on delete cascade,
 foreign key(user_id,to_rule_id) references public.synqme_persona_memories(user_id,id) on delete cascade,
 check(from_rule_id<>to_rule_id)
);
create index cognitive_rule_relation_target on public.synqme_rule_relations(user_id,to_rule_id);
alter table public.synqme_rule_relations enable row level security;
revoke all on public.synqme_rule_relations from public,anon,authenticated;
grant select on public.synqme_rule_relations to authenticated;
grant all on public.synqme_rule_relations to service_role;
grant select,insert,update on public.synqme_persona_memories to service_role;
grant select,insert,update,delete on public.synqme_decision_states,public.synqme_appliance_references to service_role;
grant select,update on public.synqme_preferences to service_role;
grant select on public.synqme_room_journeys to service_role;
create policy cognitive_relations_owner on public.synqme_rule_relations for select to authenticated
 using((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true');

create function public.check_cognitive_relation_cycle() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.relation in ('depends_on','exception_to') then
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||':rule_graph',0));
  if exists(with recursive path(id) as (
   select new.to_rule_id union select e.to_rule_id from public.synqme_rule_relations e join path p on e.from_rule_id=p.id
   where e.user_id=new.user_id and e.relation in ('depends_on','exception_to')
  ) select 1 from path where id=new.from_rule_id) then raise exception 'cognitive_dependency_cycle'; end if;
 end if;
 return new;
end $$;
create trigger cognitive_relation_cycle before insert or update on public.synqme_rule_relations
for each row execute function public.check_cognitive_relation_cycle();
revoke all on function public.check_cognitive_relation_cycle() from public,anon,authenticated;

create function public.commit_synqme_cognitive_turn_v2(p_user_id uuid,p_revision bigint,p_scope text,p_turn_key text,p_lease uuid,p_state jsonb,p_result jsonb,p_action jsonb default null,p_enrichment jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; proposals jsonb:=coalesce(p_enrichment->'memories','[]'); current_user_text text; source_time timestamptz; source_messages jsonb; previous_state jsonb; previous_key text; next_key text; outcome text;
begin
 if jsonb_typeof(proposals)<>'array' or jsonb_array_length(proposals)>8 then raise exception 'invalid_memory_proposals'; end if;
 select state into previous_state from public.synqme_cognitive_sessions where user_id=p_user_id and scope_key=p_scope;
 result:=public.commit_synqme_cognitive_turn(p_user_id,p_revision,p_scope,p_turn_key,p_lease,p_state,p_result,p_action);
 source_time:=coalesce((p_enrichment->>'sourceTimestamp')::timestamptz,clock_timestamp());
 if source_time<'2010-01-01' or source_time>now()+interval '5 minutes' then raise exception 'invalid_source_timestamp'; end if;
 if previous_state->>'lastQuestion' is not null then
  previous_key:=coalesce('cogd:'||nullif(previous_state->>'lastDecisionKey',''),'cogq:'||md5(lower(previous_state->>'lastQuestion')));
  if p_state#>>'{dispositions,-1,question}'=previous_state->>'lastQuestion' and p_state->'dispositions' is distinct from previous_state->'dispositions' then
   outcome:=case when p_state#>>'{dispositions,-1,status}' in ('deferred','not_applicable') then 'deferred' else 'response_received' end;
   update public.synqme_decision_states set status=outcome,responded_at=source_time,
    source_refs=jsonb_build_array(source_refs->0,jsonb_build_object('conversation_key','main','role','user','turn_key',p_turn_key,'answered',coalesce(p_state#>>'{dispositions,-1,answered}','false')='true')),updated_at=now()
    where user_id=p_user_id and scope_key=p_scope and decision_key=previous_key and source_memory_id is null;
  end if;
 end if;
 if p_state->>'lastQuestion' is not null and p_state->>'lastQuestion' is distinct from previous_state->>'lastQuestion' then
  next_key:=coalesce('cogd:'||nullif(p_state->>'lastDecisionKey',''),'cogq:'||md5(lower(p_state->>'lastQuestion')));
  insert into public.synqme_decision_states(user_id,scope_key,decision_key,topic,question,status,last_asked_at,asked_count,source_refs)
   values(p_user_id,p_scope,next_key,'general_household',p_state->>'lastQuestion','unanswered',source_time,1,jsonb_build_array(jsonb_build_object('conversation_key','main','role','assistant','turn_key',p_turn_key)))
   on conflict(user_id,scope_key,decision_key) do update set question=excluded.question,status='unanswered',last_asked_at=source_time,asked_count=public.synqme_decision_states.asked_count+1,updated_at=now();
 end if;
 -- A replay returns its original result and cannot enqueue another job.
 if jsonb_array_length(proposals)>0 and not exists(select 1 from public.synqme_memory_jobs where user_id=p_user_id and source_key='cognitive:'||p_turn_key) then
  select m->>'content' into current_user_text from jsonb_array_elements(p_state->'messages') with ordinality a(m,n) where m->>'role'='user' order by n desc limit 1;
  select coalesce(jsonb_agg(m order by n),'[]') into source_messages from (
   select m,n from jsonb_array_elements(p_state->'messages') with ordinality a(m,n)
   where n<jsonb_array_length(p_state->'messages') order by n desc limit 4
  ) recent;
  insert into public.synqme_memory_jobs(user_id,source_timestamp,source_key,scenario_id,messages,user_message,server_owned,runtime_revision,proposals)
   values(p_user_id,source_time,'cognitive:'||p_turn_key,p_scope,source_messages,left(current_user_text,1600),true,p_revision,proposals)
   on conflict(user_id,source_key) do nothing;
 end if;
 return result;
end $$;

create function public.claim_synqme_cognitive_memory_job() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.synqme_memory_jobs;
begin
 select * into job from public.synqme_memory_jobs j where server_owned and attempts<5
 and ((status='pending' and available_at<=now()) or (status='processing' and lease_until<now()))
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.synqme_memory_jobs set status='processing',attempts=attempts+1,lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid(),updated_at=now() where id=job.id returning * into job;
 return to_jsonb(job);
end $$;

create function public.complete_synqme_cognitive_memory_job(p_job_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.synqme_memory_jobs; revision bigint; c jsonb; target public.synqme_persona_memories; saved uuid; refs jsonb; relation text; status text; conditions jsonb; edge jsonb; other_id uuid; count_saved integer:=0; evidence_text text; retired_id uuid;
begin
 -- Lock order matches reset: revision before queue/rule rows.
 select r.revision into revision from public.synqme_training_revisions r join public.synqme_memory_jobs j on j.user_id=r.user_id where j.id=p_job_id for share of r;
 select * into job from public.synqme_memory_jobs where id=p_job_id and server_owned for update;
 if not found or job.status<>'processing' or job.lease_token is distinct from p_lease or job.lease_until<=now() then raise exception 'memory_lease_expired'; end if;
 if job.runtime_revision is distinct from revision then
  delete from public.synqme_memory_jobs where id=p_job_id; return jsonb_build_object('invalidated',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(job.user_id::text||':rule_graph',0));
 select m->>'content' into evidence_text from jsonb_array_elements(job.messages) with ordinality a(m,n) where m->>'role'='user' order by n desc limit 1;
 evidence_text:=coalesce(evidence_text,job.user_message);
 refs:=jsonb_build_array(jsonb_build_object('conversation_key','main','role','user','message_timestamp',job.source_timestamp));
 for c in select value from jsonb_array_elements(job.proposals) loop
  target:=null; saved:=null; relation:=c->>'relation';
  if length(coalesce(c->>'source_quote',''))<2 or position(lower(c->>'source_quote') in lower(evidence_text))=0 then raise exception 'memory_source_not_grounded'; end if;
  if coalesce(c->>'target_memory_key','')<>'' then
   select * into target from public.synqme_persona_memories m where m.user_id=job.user_id and m.memory_key=c->>'target_memory_key' and m.status not in ('archived','superseded') for update;
   if not found then
    select m.id into retired_id from public.synqme_persona_memories m where m.user_id=job.user_id and m.memory_key=c->>'target_memory_key' and m.status='superseded';
    with recursive versions(id,depth) as (
     select m.id,1 from public.synqme_persona_memories m where m.user_id=job.user_id and m.supersedes_id=retired_id and m.attributes->>'cognitive_job_id'=job.id::text
     union all select m.id,v.depth+1 from public.synqme_persona_memories m join versions v on m.supersedes_id=v.id where m.user_id=job.user_id and m.attributes->>'cognitive_job_id'=job.id::text and v.depth<8
    ) select m.* into target from public.synqme_persona_memories m join versions v on v.id=m.id where m.status not in ('superseded','archived') order by v.depth desc limit 1 for update of m;
    if not found then raise exception 'memory_target_changed'; end if;
   end if;
  end if;
  if relation='no_change' then continue; end if;
  if relation='new' then
   select * into target from public.synqme_persona_memories m where m.user_id=job.user_id and m.scope_key=c->>'scope_key' and m.status not in ('archived','superseded') order by m.source_timestamp desc nulls last limit 1 for update;
   if target.id is not null then
    if target.source_timestamp>job.source_timestamp then continue; end if;
    if lower(target.statement)=lower(c->>'statement') then
     if c->'attributes' ? 'appliance_v1' then
      update public.synqme_persona_memories set attributes=attributes||jsonb_build_object('appliance_v1',c#>'{attributes,appliance_v1}'),updated_at=now() where id=target.id;
     end if;
     continue;
    end if;
    -- The model may not have seen the target because its earlier extraction
    -- was still queued. A grounded explicit correction to the same precise
    -- fact dimension supersedes that older version when the worker catches up.
    relation:=case when coalesce((c->>'explicit_correction')::boolean,false) then 'updates' else 'conflicts' end;
   end if;
  end if;
  if relation in ('updates','refines','confirms','withdraws','conflicts') and target.id is null then raise exception 'memory_target_missing'; end if;
  if relation='withdraws' then
   if coalesce((c->>'explicit_withdrawal')::boolean,false)=false then raise exception 'withdrawal_not_explicit'; end if;
   update public.synqme_persona_memories set status='archived',relation='withdraws',archived_at=now() where id=target.id;
   update public.synqme_preferences set preference_status='rejected' where user_id=job.user_id and id::text=target.source_preference_id;
   continue;
  elsif relation='confirms' then
   update public.synqme_persona_memories set status='user_confirmed',relation='confirms',reviewed_at=now(),source_refs=refs,
    permission_policy=case when permission_policy='unspecified' and c->>'permission_policy' in ('ask_first','prohibited') then c->>'permission_policy' else permission_policy end,
    kind=case when permission_policy='unspecified' and c->>'permission_policy' in ('ask_first','prohibited') then 'boundary' else kind end
    where id=target.id;
   saved:=target.id;
  end if;
  if relation<>'confirms' then
  if relation='updates' and coalesce((c->>'explicit_correction')::boolean,false)=false then raise exception 'correction_not_explicit'; end if;
  conditions:=coalesce(c->'conditions','[]');
  if relation='refines' then select coalesce(jsonb_agg(v),'[]') into conditions from (select distinct value v from jsonb_array_elements(target.conditions||conditions) limit 8) valueset; end if;
  status:=case when relation='conflicts' then 'conflicting' else c->>'status' end;
  if relation in ('updates','refines') then
   update public.synqme_persona_memories set status='superseded' where id=target.id;
   update public.synqme_preferences set preference_status='superseded' where user_id=job.user_id and id::text=target.source_preference_id;
  elsif relation='conflicts' then update public.synqme_persona_memories set status='conflicting',conflict_group=target.scope_key where id=target.id;
  end if;
  insert into public.synqme_persona_memories(user_id,memory_key,topic,kind,scope_key,statement,status,relation,confidence,conditions,permission_policy,source_refs,attributes,search_terms,search_keys,source_message,source_timestamp,source_conversation_key,supersedes_id,conflict_group)
   values(job.user_id,c->>'memory_key',c->>'topic',c->>'kind',c->>'scope_key',c->>'statement',status,relation,(c->>'confidence')::numeric,conditions,c->>'permission_policy',refs,
    coalesce(c->'attributes','{}')||jsonb_build_object('scenario_id',job.scenario_id,'cognitive_job_id',job.id::text),array(select jsonb_array_elements_text(coalesce(c->'search_terms','[]'))),array(select jsonb_array_elements_text(coalesce(c->'search_keys','[]'))),c->>'statement',job.source_timestamp,'main',case when relation in ('updates','refines') then target.id end,case when relation='conflicts' then c->>'scope_key' end)
   on conflict(user_id,memory_key) do nothing returning id into saved;
  if saved is null then
   select id into saved from public.synqme_persona_memories where user_id=job.user_id and memory_key=c->>'memory_key';
   if c->'attributes' ? 'appliance_v1' then update public.synqme_persona_memories set attributes=attributes||jsonb_build_object('appliance_v1',c#>'{attributes,appliance_v1}') where user_id=job.user_id and id=saved; end if;
  end if;
  if target.id is not null and saved<>target.id and relation in ('updates','refines','conflicts') then
   insert into public.synqme_rule_relations values(job.user_id,saved,target.id,case when relation='conflicts' then 'conflicts_with' else 'supersedes' end,refs,now()) on conflict do nothing;
  end if;
  end if;
  for edge in select value from jsonb_array_elements(coalesce(c->'relations','[]')) loop
   -- A refinement already links to its previous version through supersedes.
   -- It cannot depend on the version that this same transaction just retired.
   if relation in ('updates','refines') and edge->>'target_memory_key'=c->>'target_memory_key' then continue; end if;
   select m.id into other_id from public.synqme_persona_memories m where m.user_id=job.user_id and m.memory_key=edge->>'target_memory_key' and m.status not in ('archived','superseded');
   if other_id is null then
    select m.id into retired_id from public.synqme_persona_memories m where m.user_id=job.user_id and m.memory_key=edge->>'target_memory_key' and m.status='superseded';
    with recursive versions(id,depth) as (
     select m.id,1 from public.synqme_persona_memories m where m.user_id=job.user_id and m.supersedes_id=retired_id and m.attributes->>'cognitive_job_id'=job.id::text
     union all select m.id,v.depth+1 from public.synqme_persona_memories m join versions v on m.supersedes_id=v.id where m.user_id=job.user_id and m.attributes->>'cognitive_job_id'=job.id::text and v.depth<8
    ) select m.id into other_id from public.synqme_persona_memories m join versions v on v.id=m.id where m.status not in ('superseded','archived') order by v.depth desc limit 1;
   end if;
   if other_id is null then raise exception 'relation_target_changed'; end if;
   insert into public.synqme_rule_relations values(job.user_id,saved,other_id,edge->>'kind',refs,now()) on conflict do nothing;
  end loop;
  count_saved:=count_saved+1;
 end loop;
 update public.synqme_memory_jobs set status='done',messages='[]',user_message='',proposals='[]',lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=p_job_id;
 return jsonb_build_object('saved',count_saved);
end $$;

create function public.retry_synqme_cognitive_memory_job(p_job_id uuid,p_lease uuid) returns void
language sql security invoker set search_path='' as $$
 update public.synqme_memory_jobs set status='pending',available_at=now()+make_interval(secs=>least(900,30*power(2,least(attempts,5)))::int),lease_token=null,lease_until=null,last_error='processing_unavailable',updated_at=now()
 where id=p_job_id and server_owned and status='processing' and lease_token=p_lease;
$$;

create or replace function public.clear_synqme_cognitive_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.revision>old.revision then
  delete from public.synqme_cognitive_turns where user_id=new.user_id and training_revision<new.revision;
  delete from public.synqme_cognitive_sessions where user_id=new.user_id and training_revision<new.revision;
  delete from public.synqme_memory_jobs where user_id=new.user_id and server_owned and runtime_revision<new.revision;
 end if; return new;
end $$;
revoke all on function public.commit_synqme_cognitive_turn_v2(uuid,bigint,text,text,uuid,jsonb,jsonb,jsonb,jsonb),public.claim_synqme_cognitive_memory_job(),public.complete_synqme_cognitive_memory_job(uuid,uuid),public.retry_synqme_cognitive_memory_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.commit_synqme_cognitive_turn_v2(uuid,bigint,text,text,uuid,jsonb,jsonb,jsonb,jsonb),public.claim_synqme_cognitive_memory_job(),public.complete_synqme_cognitive_memory_job(uuid,uuid),public.retry_synqme_cognitive_memory_job(uuid,uuid) to service_role;
