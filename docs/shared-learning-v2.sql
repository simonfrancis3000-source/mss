create extension if not exists pg_trgm with schema extensions;
alter table public.synqme_shared_knowledge add column scenario_id text, add column candidate_kind text not null default 'decision_rule' check(candidate_kind in('decision_rule','common_question','novel_situation','unanswered_question'));
alter table public.synqme_knowledge_candidates add column scenario_id text, add column candidate_kind text not null default 'decision_rule' check(candidate_kind in('decision_rule','common_question','novel_situation','unanswered_question')), add column shared_id uuid references public.synqme_shared_knowledge(id) on delete set null;
create index shared_learning_scope on public.synqme_shared_knowledge(scenario_id,status,quality_score desc,evidence_count desc);
create index shared_learning_prompt_trgm on public.synqme_shared_knowledge using gin(prompt_pattern extensions.gin_trgm_ops);
create index shared_learning_queue on public.synqme_knowledge_candidates(created_at) where shared_id is null and status='pending_review';
create index shared_learning_sources on public.synqme_knowledge_candidates(shared_id,user_id);
create trigger check_training_revision before insert on public.synqme_knowledge_candidates for each row execute function public.synqme_check_training_revision();
create schema if not exists private;
create function private.synqme_group_learning() returns integer language plpgsql security definer set search_path='' as $$
declare c record; target uuid; processed integer:=0;
begin
 for c in select k.* from public.synqme_knowledge_candidates k join public.synqme_profiles p on p.user_id=k.user_id and p.share_anonymized_learning and p.share_learning_consent_at=k.consent_at where k.status='pending_review' and k.shared_id is null order by k.created_at for update of k skip locked limit 100 loop
  target:=null;
  select s.id into target from public.synqme_shared_knowledge s where s.scenario_id is not distinct from c.scenario_id and s.candidate_kind=c.candidate_kind and s.category=c.category and s.prompt_pattern operator(extensions.%) c.prompt_pattern and extensions.similarity(s.prompt_pattern,c.prompt_pattern)>=0.65 order by extensions.similarity(s.prompt_pattern,c.prompt_pattern) desc limit 1;
  if target is null then
   insert into public.synqme_shared_knowledge(category,prompt_pattern,answer_pattern,general_principle,context_tags,key_terms,applicability,limitations,fingerprint,status,scenario_id,candidate_kind)
   values(c.category,c.prompt_pattern,c.answer_pattern,c.general_principle,c.context_tags,c.key_terms,c.applicability,c.limitations,c.fingerprint,'pending_review',c.scenario_id,c.candidate_kind)
   on conflict(fingerprint) do update set updated_at=now() returning id into target;
  end if;
  update public.synqme_knowledge_candidates set shared_id=target where id=c.id;
  update public.synqme_shared_knowledge set evidence_count=(select count(distinct user_id) from public.synqme_knowledge_candidates where shared_id=target),updated_at=now() where id=target;
  processed:=processed+1;
 end loop;
 return processed;
end $$;
revoke all on function private.synqme_group_learning() from public,anon,authenticated;
select cron.schedule('synqme-group-learning','* * * * *','select private.synqme_group_learning()');
-- Review access uses the existing admin account allowlist, never editable user metadata.
create policy shared_learning_admin_read on public.synqme_shared_knowledge for select to authenticated using ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid);
create policy shared_learning_admin_update on public.synqme_shared_knowledge for update to authenticated using ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid) with check ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid);
grant update on public.synqme_shared_knowledge to authenticated;
create table public.synqme_knowledge_versions(id uuid primary key default gen_random_uuid(),knowledge_id uuid not null references public.synqme_shared_knowledge(id),version integer not null,snapshot jsonb not null,reviewed_at timestamptz not null default now(),unique(knowledge_id,version));
alter table public.synqme_knowledge_versions enable row level security;
grant select,insert on public.synqme_knowledge_versions to authenticated;
create policy learning_versions_admin on public.synqme_knowledge_versions for all to authenticated using ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid) with check ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid);
create function public.synqme_review_learning(p_id uuid,p_action text) returns void language plpgsql security invoker set search_path='' as $$
declare item public.synqme_shared_knowledge;
begin
 if auth.uid() is distinct from 'c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Administrator access required.'; end if;
 if p_action not in ('approved','rejected','retired') then raise exception 'Invalid review action.'; end if;
 select * into item from public.synqme_shared_knowledge where id=p_id for update;
 if item.id is null then raise exception 'Learning item not found.'; end if;
 insert into public.synqme_knowledge_versions(knowledge_id,version,snapshot) values(item.id,item.version,to_jsonb(item)) on conflict do nothing;
 update public.synqme_shared_knowledge set status=p_action,version=version+1,quality_score=case when p_action='approved' then 0.8 else 0 end,updated_at=now() where id=p_id;
end $$;
revoke all on function public.synqme_review_learning(uuid,text) from public,anon;
grant execute on function public.synqme_review_learning(uuid,text) to authenticated;
create function private.synqme_recount_learning() returns trigger language plpgsql security definer set search_path='' as $$ declare sources integer; begin if OLD.shared_id is not null then select count(distinct user_id) into sources from public.synqme_knowledge_candidates where shared_id=OLD.shared_id; update public.synqme_shared_knowledge set evidence_count=sources,status=case when sources=0 and status='pending_review' then 'rejected' else status end,updated_at=now() where id=OLD.shared_id; end if; return OLD; end $$;
revoke all on function private.synqme_recount_learning() from public,anon,authenticated;
create trigger recount_learning_sources after delete on public.synqme_knowledge_candidates for each row execute function private.synqme_recount_learning();
alter policy shared_learning_admin_read on public.synqme_shared_knowledge using ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);
alter policy shared_learning_admin_update on public.synqme_shared_knowledge using ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false) with check ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);
alter policy learning_versions_admin on public.synqme_knowledge_versions using ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false) with check ((select auth.uid())='c00dc862-a5dc-4537-893c-6d4c3d65320b'::uuid and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);
