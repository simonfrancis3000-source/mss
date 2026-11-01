begin;
insert into auth.users(id,email) values('d85b1100-1111-4111-8111-000000000001','learning-fixture-1@example.invalid'),('d85b1100-1111-4111-8111-000000000002','learning-fixture-2@example.invalid');
insert into public.synqme_profiles(user_id,share_anonymized_learning,share_learning_consent_at) values('d85b1100-1111-4111-8111-000000000001',true,'2026-11-01T00:00:00Z'),('d85b1100-1111-4111-8111-000000000002',true,'2026-11-01T00:00:00Z');
insert into public.synqme_knowledge_candidates(user_id,category,prompt_pattern,answer_pattern,general_principle,context_tags,key_terms,fingerprint,consent_at,scenario_id,candidate_kind)
select id,'living_room','How should an unfinished puzzle on a table be treated?','Ask before disturbing unfinished activities.','An item left out is not necessarily clutter.',array['living_room'],array['puzzle','unfinished'],'fixture-learning-'||n,'2026-11-01T00:00:00Z','room:living_room','novel_situation' from (values('d85b1100-1111-4111-8111-000000000001'::uuid,1),('d85b1100-1111-4111-8111-000000000002'::uuid,2)) u(id,n);
select private.synqme_group_learning();
do $$ begin
 if (select count(distinct shared_id) from public.synqme_knowledge_candidates where fingerprint like 'fixture-learning-%')<>1 then raise exception 'FAILED deduplication'; end if;
 if not exists(select 1 from public.synqme_shared_knowledge where prompt_pattern='How should an unfinished puzzle on a table be treated?' and evidence_count=2 and status='pending_review') then raise exception 'FAILED count or review gate'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d85b1100-1111-4111-8111-000000000001',true);
do $$ begin
 if exists(select 1 from public.synqme_shared_knowledge where prompt_pattern='How should an unfinished puzzle on a table be treated?') then raise exception 'FAILED pending visibility'; end if;
 begin perform public.synqme_review_learning(gen_random_uuid(),'approved'); raise exception 'FAILED unauthorised review'; exception when raise_exception then if SQLERRM<>'Administrator access required.' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','c00dc862-a5dc-4537-893c-6d4c3d65320b',true);
select public.synqme_review_learning((select id from public.synqme_shared_knowledge where prompt_pattern='How should an unfinished puzzle on a table be treated?'),'approved');
reset role;
rollback;
