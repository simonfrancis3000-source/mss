begin;
insert into auth.users(id,email) values ('b8111111-1111-4111-8111-111111111111','memory-queue-one@example.invalid'),('b8222222-2222-4222-8222-222222222222','memory-queue-two@example.invalid');
insert into public.synqme_conversations(user_id,messages) values
('b8111111-1111-4111-8111-111111111111','[{"role":"user","content":"Kitchen fixture","timestamp":"2026-11-01T19:00:00Z","scenario_id":"room:kitchen"},{"role":"user","content":"Living fixture","timestamp":"2026-11-01T19:01:00.000Z","scenario_id":"room:living_room"}]'),
('b8222222-2222-4222-8222-222222222222','[]');
insert into public.synqme_room_journeys(user_id,active_room_id) values ('b8111111-1111-4111-8111-111111111111','kitchen');
set local role authenticated;
select set_config('request.jwt.claim.sub','b8111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"b8111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select set_config('request.headers','{"x-training-revision":"0"}',true);
insert into public.synqme_memory_jobs(user_id,source_timestamp,source_key,scenario_id,messages,user_message) values
(auth.uid(),'2026-11-01T19:00:00Z','job-kitchen','room:kitchen','[{"role":"user","content":"Kitchen fixture"}]','Kitchen fixture'),
(auth.uid(),'2026-11-01T19:01:00Z','job-living','room:living_room','[{"role":"user","content":"Living fixture"}]','Living fixture');
do $$ declare claimed record; begin
 select * into claimed from public.synqme_claim_memory_job();
 if claimed.status <> 'processing' or claimed.lease_token is null or claimed.user_id <> auth.uid() then raise exception 'FAILED claim'; end if;
 if (select count(*) from public.synqme_memory_jobs where status='processing')<>1 then raise exception 'FAILED claim count'; end if;
 begin
  insert into public.synqme_memory_jobs(user_id,source_timestamp,source_key) values ('b8222222-2222-4222-8222-222222222222',now(),'other-account');
  raise exception 'FAILED cross-account insert';
 exception when insufficient_privilege then null; end;
 if public.synqme_reset_training('RESET','room:kitchen')<>1 then raise exception 'FAILED scenario reset'; end if;
 if exists(select 1 from public.synqme_memory_jobs where scenario_id='room:kitchen') then raise exception 'FAILED queue reset'; end if;
 if (select count(*) from public.synqme_memory_jobs where scenario_id='room:living_room')<>1 then raise exception 'FAILED preserve other scenario'; end if;
 begin update public.synqme_memory_jobs set status='done' where scenario_id='room:living_room'; raise exception 'FAILED stale revision'; exception when serialization_failure then null; end;
 perform set_config('request.headers','{"x-training-revision":"1"}',true);
 if public.synqme_reset_training('RESET',null)<>2 then raise exception 'FAILED full reset'; end if;
 if exists(select 1 from public.synqme_memory_jobs) then raise exception 'FAILED full queue reset'; end if;
end $$;
reset role;
rollback;
