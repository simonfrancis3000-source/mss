begin;
insert into auth.users(id,email) values ('a21a1d11-7dcb-4124-a343-1abc1d3a0001','reset-test-1@example.invalid'),('a21a1d11-7dcb-4124-a343-1abc1d3a0002','reset-test-2@example.invalid');
insert into public.synqme_conversations(user_id,messages) values
('a21a1d11-7dcb-4124-a343-1abc1d3a0001','[{"role":"user","content":"Kitchen preference fixture","timestamp":"2026-11-01T19:00:00Z","scenario_id":"room:kitchen"},{"role":"assistant","content":"Kitchen reply fixture","timestamp":"2026-11-01T19:00:01Z","scenario_id":"room:kitchen"},{"role":"user","content":"Living room preference fixture","timestamp":"2026-11-01T19:01:00Z","scenario_id":"room:living_room"}]'),
('a21a1d11-7dcb-4124-a343-1abc1d3a0002','[{"role":"user","content":"Other account fixture"}]');
insert into public.synqme_room_journeys(user_id) values('a21a1d11-7dcb-4124-a343-1abc1d3a0001');
insert into public.synqme_persona_memories(user_id,memory_key,statement,attributes,source_timestamp) values
('a21a1d11-7dcb-4124-a343-1abc1d3a0001','reset-fixture-kitchen','Kitchen preference fixture','{"scenario_id":"room:kitchen"}','2026-11-01T19:00:00Z'),
('a21a1d11-7dcb-4124-a343-1abc1d3a0001','reset-fixture-living','Living room preference fixture','{"scenario_id":"room:living_room"}','2026-11-01T19:01:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','a21a1d11-7dcb-4124-a343-1abc1d3a0001',true);
select set_config('request.jwt.claims','{"sub":"a21a1d11-7dcb-4124-a343-1abc1d3a0001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.headers','{"x-training-revision":"0"}',true);
do $$ begin
 begin perform public.synqme_reset_training('reset','room:kitchen'); raise exception 'FAILED confirmation'; exception when raise_exception then if SQLERRM='FAILED confirmation' then raise; end if; end;
 if public.synqme_reset_training('RESET','room:kitchen')<>1 then raise exception 'FAILED scenario reset'; end if;
 if (select jsonb_array_length(messages) from public.synqme_conversations where user_id=auth.uid())<>1 then raise exception 'FAILED transcript scoping'; end if;
 if (select count(*) from public.synqme_persona_memories where user_id=auth.uid())<>1 then raise exception 'FAILED memory scoping'; end if;
 begin update public.synqme_conversations set messages='[]' where user_id=auth.uid(); raise exception 'FAILED stale revision'; exception when serialization_failure then null; end;
 perform set_config('request.headers','{"x-training-revision":"1"}',true);
 if public.synqme_reset_training('RESET',null)<>2 then raise exception 'FAILED full reset'; end if;
 if (select jsonb_array_length(messages) from public.synqme_conversations where user_id=auth.uid())<>0 then raise exception 'FAILED full transcript'; end if;
 if exists(select 1 from public.synqme_persona_memories where user_id=auth.uid()) then raise exception 'FAILED full memories'; end if;
end $$;
reset role;
do $$ begin if (select jsonb_array_length(messages) from public.synqme_conversations where user_id='a21a1d11-7dcb-4124-a343-1abc1d3a0002')<>1 then raise exception 'FAILED account isolation'; end if; end $$;
rollback;
