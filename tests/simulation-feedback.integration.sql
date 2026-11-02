begin;
insert into auth.users(id,email) values ('b8444444-4444-4444-8444-444444444444','simulation-owner@example.invalid'),('b8555555-5555-4555-8555-555555555555','simulation-other@example.invalid');
insert into public.synqme_conversations(user_id,messages) values ('b8444444-4444-4444-8444-444444444444','[{"role":"user","content":"Kitchen fixture","timestamp":"2026-11-01T19:00:00Z","scenario_id":"room:kitchen"},{"role":"user","content":"Living fixture","timestamp":"2026-11-01T19:01:00Z","scenario_id":"room:living_room"}]');
insert into public.synqme_room_journeys(user_id,active_room_id) values ('b8444444-4444-4444-8444-444444444444','kitchen');
set local role authenticated;
select set_config('request.jwt.claim.sub','b8444444-4444-4444-8444-444444444444',true);
select set_config('request.jwt.claims','{"sub":"b8444444-4444-4444-8444-444444444444","role":"authenticated","is_anonymous":false}',true);
select set_config('request.headers','{"x-training-revision":"0"}',true);
insert into public.synqme_evaluation_records(user_id,evaluation_key,scope_key,evaluation_kind,origin,outcome,checks,source_refs,engine_version) values
(auth.uid(),'simulation-feedback:kitchen','room:kitchen','conversation_turn','runtime_observation','observed','{"event":"hypothetical_situation_feedback","user_feedback":"agreed","area_id":"dishwashing","situation":"A hypothetical situation","proposed_response":"I would ask first.","evidence_ids":[]}','[{"scenario_id":"room:kitchen","area_id":"dishwashing"}]','simulation-preview-v1'),
(auth.uid(),'simulation-feedback:living','room:living_room','conversation_turn','runtime_observation','observed','{"event":"hypothetical_situation_feedback","user_feedback":"different","area_id":"tidying","situation":"Another hypothetical situation","proposed_response":"I would ask first.","evidence_ids":[]}','[{"scenario_id":"room:living_room","area_id":"tidying"}]','simulation-preview-v1');
do $$ begin
 if (select count(*) from public.synqme_evaluation_records where checks @> '{"event":"hypothetical_situation_feedback"}')<>2 then raise exception 'FAILED feedback insert'; end if;
 begin
  insert into public.synqme_evaluation_records(user_id,evaluation_key,scope_key,evaluation_kind,origin,outcome) values('b8555555-5555-4555-8555-555555555555','other','room:kitchen','conversation_turn','runtime_observation','observed');
  raise exception 'FAILED cross-account write';
 exception when insufficient_privilege then null; end;
 if public.synqme_reset_training('RESET','room:kitchen')<>1 then raise exception 'FAILED reset'; end if;
 if exists(select 1 from public.synqme_evaluation_records where evaluation_key='simulation-feedback:kitchen') then raise exception 'FAILED remove target feedback'; end if;
 if not exists(select 1 from public.synqme_evaluation_records where evaluation_key='simulation-feedback:living') then raise exception 'FAILED preserve other feedback'; end if;
end $$;
reset role;
rollback;
