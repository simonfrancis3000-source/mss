-- AMIA server-owned state and exactly-once reminder effects. Rollout remains
-- disabled until this migration and the independent database tests pass.
create table public.synqme_cognitive_sessions (
 user_id uuid not null references auth.users(id) on delete cascade,
 scope_key text not null check (length(scope_key) between 1 and 120 and scope_key ~ '^(room|outside):[a-z0-9_:-]+$'),
 training_revision bigint not null check (training_revision >= 0),
 state_version bigint not null default 0,
 state jsonb not null default '{}' check (jsonb_typeof(state)='object' and octet_length(state::text)<=131072),
 active_turn_key text,
 lease uuid,
 lease_until timestamptz,
 updated_at timestamptz not null default now(),
 primary key(user_id,scope_key)
);
create table public.synqme_cognitive_turns (
 user_id uuid not null references auth.users(id) on delete cascade,
 training_revision bigint not null,
 turn_key text not null check (turn_key ~ '^[a-f0-9]{64}$'),
 scope_key text not null,
 fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
 status text not null check (status in ('in_progress','completed','failed')),
 result jsonb check (result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=16384)),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(user_id,training_revision,turn_key)
);
create index cognitive_turns_scope on public.synqme_cognitive_turns(user_id,scope_key,created_at desc);
alter table public.synqme_cognitive_sessions enable row level security;
alter table public.synqme_cognitive_turns enable row level security;
revoke all on public.synqme_cognitive_sessions,public.synqme_cognitive_turns from public,anon,authenticated;
grant select on public.synqme_cognitive_sessions,public.synqme_cognitive_turns to authenticated;
-- Reset callers may remove invalidated epochs, but cannot mutate live state.
grant delete on public.synqme_cognitive_sessions,public.synqme_cognitive_turns to authenticated;
grant all on public.synqme_cognitive_sessions,public.synqme_cognitive_turns to service_role;
grant select,insert,update on public.synqme_training_revisions to service_role;
grant select on public.synqme_conversations to service_role;
grant select,insert,update,delete on public.synqme_reminders to service_role;
create policy cognitive_sessions_owner on public.synqme_cognitive_sessions for select to authenticated
 using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true');
create policy cognitive_turns_owner on public.synqme_cognitive_turns for select to authenticated
 using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true');
create policy cognitive_sessions_reset on public.synqme_cognitive_sessions for delete to authenticated
 using ((select auth.uid())=user_id and training_revision<(select r.revision from public.synqme_training_revisions r where r.user_id=(select auth.uid())));
create policy cognitive_turns_reset on public.synqme_cognitive_turns for delete to authenticated
 using ((select auth.uid())=user_id and training_revision<(select r.revision from public.synqme_training_revisions r where r.user_id=(select auth.uid())));

create function public.clear_synqme_cognitive_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.revision>old.revision then
  delete from public.synqme_cognitive_turns where user_id=new.user_id and training_revision<new.revision;
  delete from public.synqme_cognitive_sessions where user_id=new.user_id and training_revision<new.revision;
 end if;
 return new;
end $$;
create trigger clear_cognitive_revision after update of revision on public.synqme_training_revisions
 for each row execute function public.clear_synqme_cognitive_revision();
revoke all on function public.clear_synqme_cognitive_revision() from public,anon,authenticated;

-- All functions are SECURITY INVOKER and executable only by the server role.
-- p_user_id comes exclusively from the backend's verified Supabase Auth user.
create function public.claim_synqme_cognitive_turn(p_user_id uuid,p_revision bigint,p_scope text,p_turn_key text,p_fingerprint text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.synqme_cognitive_sessions; t public.synqme_cognitive_turns; revision bigint; token uuid; seed jsonb;
begin
 if p_user_id is null or p_revision<0 or p_turn_key !~ '^[a-f0-9]{64}$' or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'runtime_turn_conflict'; end if;
 insert into public.synqme_training_revisions(user_id) values(p_user_id) on conflict do nothing;
 select r.revision into revision from public.synqme_training_revisions r where user_id=p_user_id for share;
 if revision is distinct from p_revision then raise exception 'runtime_revision_changed'; end if;
 -- Seed once from the saved, scoped transcript, never a request's transcript.
 select coalesce(jsonb_agg(m order by n),'[]') into seed from (
  select jsonb_build_object('role',m->>'role','content',left(m->>'content',3000)) m,n from public.synqme_conversations c, lateral jsonb_array_elements(c.messages) with ordinality a(m,n)
  where c.user_id=p_user_id and m->>'scenario_id'=p_scope and m->>'role' in ('user','assistant')
    and jsonb_typeof(m->'content')='string' and coalesce((m->>'transcript_final')::boolean,true)
  order by n desc limit 20
 ) history;
 insert into public.synqme_cognitive_sessions(user_id,scope_key,training_revision,state)
 values(p_user_id,p_scope,p_revision,jsonb_build_object('messages',coalesce(seed,'[]')))
 on conflict do nothing;
 select * into s from public.synqme_cognitive_sessions where user_id=p_user_id and scope_key=p_scope for update;
 if s.training_revision<>p_revision then
  update public.synqme_cognitive_sessions set training_revision=p_revision,state=jsonb_build_object('messages',coalesce(seed,'[]')),state_version=0,active_turn_key=null,lease=null,lease_until=null
  where user_id=p_user_id and scope_key=p_scope returning * into s;
 end if;
 select * into t from public.synqme_cognitive_turns where user_id=p_user_id and training_revision=p_revision and turn_key=p_turn_key;
 if found then
  if t.fingerprint<>p_fingerprint or t.scope_key<>p_scope then raise exception 'runtime_turn_conflict'; end if;
  if t.status='completed' then return jsonb_build_object('status','completed','result',t.result); end if;
 end if;
 if s.lease_until>clock_timestamp() then raise exception 'runtime_busy'; end if;
 if s.active_turn_key is not null then
  update public.synqme_cognitive_turns set status='failed',updated_at=now()
  where user_id=p_user_id and training_revision=p_revision and turn_key=s.active_turn_key and status='in_progress';
 end if;
 token:=gen_random_uuid();
 insert into public.synqme_cognitive_turns(user_id,training_revision,turn_key,scope_key,fingerprint,status)
 values(p_user_id,p_revision,p_turn_key,p_scope,p_fingerprint,'in_progress')
 on conflict(user_id,training_revision,turn_key) do update set status='in_progress',updated_at=now();
 update public.synqme_cognitive_sessions set active_turn_key=p_turn_key,lease=token,lease_until=clock_timestamp()+interval '90 seconds',updated_at=now()
 where user_id=p_user_id and scope_key=p_scope;
 return jsonb_build_object('status','claimed','lease',token,'state',s.state,'stateVersion',s.state_version);
end $$;

create function public.commit_synqme_cognitive_turn(p_user_id uuid,p_revision bigint,p_scope text,p_turn_key text,p_lease uuid,p_state jsonb,p_result jsonb,p_action jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.synqme_cognitive_sessions; t public.synqme_cognitive_turns; revision bigint; reminder uuid; affected integer; v_result jsonb:=p_result; action_type text;
begin
 select r.revision into revision from public.synqme_training_revisions r where user_id=p_user_id for share;
 if revision is distinct from p_revision then raise exception 'runtime_revision_changed'; end if;
 select * into s from public.synqme_cognitive_sessions where user_id=p_user_id and scope_key=p_scope for update;
 select * into t from public.synqme_cognitive_turns where user_id=p_user_id and training_revision=p_revision and turn_key=p_turn_key;
 if t.scope_key is distinct from p_scope then raise exception 'runtime_turn_conflict'; end if;
 if t.status='completed' then return jsonb_build_object('status','completed','result',t.result); end if;
 if s.training_revision is distinct from p_revision or s.active_turn_key is distinct from p_turn_key or s.lease is distinct from p_lease or s.lease_until<=clock_timestamp() or t.status is distinct from 'in_progress' then raise exception 'runtime_stale_lease'; end if;
 if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object' or coalesce(length(btrim(p_result->>'reply')),0) not between 1 and 5000 then raise exception 'invalid_runtime_result'; end if;
 if p_action is not null then
  action_type:=p_action->>'type';
  if action_type not in ('add','edit','complete','delete') or action_type is null then raise exception 'unsupported_runtime_action'; end if;
  if action_type in ('add','edit') and coalesce(length(btrim(p_action->>'title')),0) not between 3 and 500 then raise exception 'invalid_reminder_title'; end if;
  if action_type='add' then
   insert into public.synqme_reminders(user_id,title,completed,scenario_id) values(p_user_id,btrim(p_action->>'title'),false,p_scope) returning id into reminder;
  else
   reminder:=(p_action->>'id')::uuid;
   if action_type='delete' then delete from public.synqme_reminders where user_id=p_user_id and id=reminder;
   elsif action_type='complete' then update public.synqme_reminders set completed=true,updated_at=now() where user_id=p_user_id and id=reminder;
   else update public.synqme_reminders set title=btrim(p_action->>'title'),updated_at=now() where user_id=p_user_id and id=reminder;
   end if;
   get diagnostics affected = row_count;
   if affected<>1 then raise exception 'runtime_reminder_changed'; end if;
  end if;
  v_result:=jsonb_set(v_result,'{runtime}',coalesce(v_result->'runtime','{}')||jsonb_build_object('actionId',reminder));
 end if;
 -- Constraint failures roll back the reminder as well as both state writes.
 update public.synqme_cognitive_turns set status='completed',result=v_result,updated_at=now()
 where user_id=p_user_id and training_revision=p_revision and turn_key=p_turn_key;
 update public.synqme_cognitive_sessions set state=p_state,state_version=state_version+1,active_turn_key=null,lease=null,lease_until=null,updated_at=now()
 where user_id=p_user_id and scope_key=p_scope;
 return jsonb_build_object('status','completed','result',v_result);
end $$;

create function public.release_synqme_cognitive_turn(p_user_id uuid,p_revision bigint,p_scope text,p_turn_key text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare revision bigint; s public.synqme_cognitive_sessions;
begin
 select r.revision into revision from public.synqme_training_revisions r where user_id=p_user_id for share;
 if revision is distinct from p_revision then raise exception 'runtime_revision_changed'; end if;
 select * into s from public.synqme_cognitive_sessions where user_id=p_user_id and scope_key=p_scope for update;
 if s.training_revision=p_revision and s.active_turn_key=p_turn_key and s.lease=p_lease then
  update public.synqme_cognitive_turns set status='failed',updated_at=now()
  where user_id=p_user_id and training_revision=p_revision and turn_key=p_turn_key and status='in_progress';
  update public.synqme_cognitive_sessions set active_turn_key=null,lease=null,lease_until=null where user_id=p_user_id and scope_key=p_scope;
 end if;
 return jsonb_build_object('released',true);
end $$;

revoke all on function public.claim_synqme_cognitive_turn(uuid,bigint,text,text,text) from public,anon,authenticated;
revoke all on function public.commit_synqme_cognitive_turn(uuid,bigint,text,text,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.release_synqme_cognitive_turn(uuid,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_synqme_cognitive_turn(uuid,bigint,text,text,text) to service_role;
grant execute on function public.commit_synqme_cognitive_turn(uuid,bigint,text,text,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.release_synqme_cognitive_turn(uuid,bigint,text,text,uuid) to service_role;

comment on table public.synqme_cognitive_sessions is 'Server-owned scoped AMIA state. Revision mismatch invalidates all continuation state after any training reset; old revisions are never reused.';
comment on table public.synqme_cognitive_turns is 'Canonical committed turn results and idempotency ledger. Generated is not proof of audio playback. Private, user-owned conversation data.';
