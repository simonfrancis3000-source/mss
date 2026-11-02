-- Durable, account-owned extraction queue. Content is removed after processing.
create table public.synqme_memory_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 source_timestamp timestamptz not null,
 source_key text not null check (length(source_key) between 1 and 100),
 scenario_id text,
 messages jsonb not null default '[]'::jsonb,
 user_message text not null default '',
 status text not null default 'pending' check (status in ('pending','processing','done')),
 attempts integer not null default 0 check (attempts >= 0),
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 lease_token uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,source_key),
 check (jsonb_typeof(messages)='array' and jsonb_array_length(messages)<=8),
 check (length(user_message)<=1600),
 check (scenario_id is null or (length(scenario_id)<=120 and scenario_id ~ '^(room|outside):[a-z0-9_:-]+$'))
);
alter table public.synqme_memory_jobs enable row level security;
revoke all on public.synqme_memory_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.synqme_memory_jobs to authenticated;
create policy memory_jobs_owner on public.synqme_memory_jobs for all to authenticated
 using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false)
 with check ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)=false);
create index memory_jobs_ready on public.synqme_memory_jobs(user_id,available_at,created_at) where status <> 'done';
create trigger check_training_revision before insert or update on public.synqme_memory_jobs
 for each row execute function public.synqme_check_training_revision();

create function public.synqme_claim_memory_job() returns setof public.synqme_memory_jobs
 language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Registered account required' using errcode='42501'; end if;
 return query with candidate as (
   select id from public.synqme_memory_jobs where user_id=auth.uid()
    and ((status='pending' and available_at<=now()) or (status='processing' and lease_until<now()))
    order by created_at for update skip locked limit 1
 ) update public.synqme_memory_jobs j set status='processing',attempts=j.attempts+1,
    lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid(),updated_at=now()
   from candidate c where j.id=c.id and j.user_id=auth.uid() returning j.*;
end $$;
revoke all on function public.synqme_claim_memory_job() from public,anon;
grant execute on function public.synqme_claim_memory_job() to authenticated;

-- Reset removes only jobs whose source turn was removed from the transcript.
-- Jobs for other scenarios survive a scenario reset and can be resumed.
create function public.synqme_prune_reset_memory_jobs() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare reset_scope text;
begin
 if new.revision is not distinct from old.revision then return new; end if;
 select room_progress#>>'{scenario_journey_v1,started}' into reset_scope
  from public.synqme_room_journeys where user_id=new.user_id;
 if reset_scope is null then
  delete from public.synqme_memory_jobs where user_id=new.user_id;
 else
  -- Unknown-source pending jobs cannot be safely attributed to one scenario.
  if exists(select 1 from public.synqme_memory_jobs j where j.user_id=new.user_id and j.scenario_id is null and j.status <> 'done' and not exists (
    select 1 from public.synqme_conversations c, lateral jsonb_array_elements(coalesce(c.messages,'[]'::jsonb)) m
    where c.user_id=new.user_id and m->>'role'='user' and
      case when pg_catalog.pg_input_is_valid(m->>'timestamp','timestamp with time zone') then (m->>'timestamp')::timestamptz=j.source_timestamp else false end
  )) then raise exception 'A pending memory has no reliable scenario source. Open the app and let memory updates sync before resetting.'; end if;
  delete from public.synqme_memory_jobs j where j.user_id=new.user_id and (j.scenario_id=reset_scope or (j.scenario_id is null and j.status='done' and not exists (
    select 1 from public.synqme_conversations c, lateral jsonb_array_elements(coalesce(c.messages,'[]'::jsonb)) m
    where c.user_id=new.user_id and m->>'role'='user' and
      case when pg_catalog.pg_input_is_valid(m->>'timestamp','timestamp with time zone') then (m->>'timestamp')::timestamptz=j.source_timestamp else false end
  )));
 end if;
 return new;
end $$;
revoke all on function public.synqme_prune_reset_memory_jobs() from public,anon;
create trigger prune_reset_memory_jobs after update of revision on public.synqme_training_revisions
 for each row execute function public.synqme_prune_reset_memory_jobs();
