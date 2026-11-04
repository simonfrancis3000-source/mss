create table public.synqme_cognitive_deliveries (
 user_id uuid not null references auth.users(id) on delete cascade,
 training_revision bigint not null,
 turn_key text not null,
 delivery_key text not null check(length(delivery_key) between 1 and 100),
 channel text not null check(channel in ('chat','phonic')),
 status text not null check(status in ('dispatched','playback_started','playback_completed','interrupted','failed')),
 sequence integer not null check(sequence between 1 and 1000),
 origin text not null default 'client_observation' check(origin='client_observation'),
 observed_at timestamptz not null default now(),
 primary key(user_id,training_revision,turn_key,delivery_key),
 foreign key(user_id,training_revision,turn_key) references public.synqme_cognitive_turns(user_id,training_revision,turn_key) on delete cascade
);
alter table public.synqme_cognitive_deliveries enable row level security;
revoke all on public.synqme_cognitive_deliveries from public,anon,authenticated;
grant select on public.synqme_cognitive_deliveries to authenticated;
grant all on public.synqme_cognitive_deliveries to service_role;
create policy cognitive_delivery_owner on public.synqme_cognitive_deliveries for select to authenticated
 using((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true');

create function public.record_synqme_cognitive_delivery(p_user_id uuid,p_revision bigint,p_turn_key text,p_delivery_key text,p_channel text,p_status text,p_sequence integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous public.synqme_cognitive_deliveries; revision bigint;
begin
 select r.revision into revision from public.synqme_training_revisions r where user_id=p_user_id for share;
 if revision is distinct from p_revision then raise exception 'runtime_revision_changed'; end if;
 perform 1 from public.synqme_cognitive_turns where user_id=p_user_id and training_revision=p_revision and turn_key=p_turn_key and status='completed' for share;
 if not found then raise exception 'delivery_turn_missing'; end if;
 select * into previous from public.synqme_cognitive_deliveries where user_id=p_user_id and training_revision=p_revision and turn_key=p_turn_key and delivery_key=p_delivery_key for update;
 if found and (previous.sequence>=p_sequence or previous.status in ('playback_completed','interrupted','failed')) then return jsonb_build_object('recorded',true,'unchanged',true); end if;
 if p_channel='chat' and p_status not in ('dispatched','failed') then raise exception 'invalid_chat_delivery'; end if;
 insert into public.synqme_cognitive_deliveries(user_id,training_revision,turn_key,delivery_key,channel,status,sequence)
 values(p_user_id,p_revision,p_turn_key,p_delivery_key,p_channel,p_status,p_sequence)
 on conflict(user_id,training_revision,turn_key,delivery_key) do update set status=excluded.status,sequence=excluded.sequence,observed_at=now()
 where public.synqme_cognitive_deliveries.sequence<excluded.sequence and public.synqme_cognitive_deliveries.status not in ('playback_completed','interrupted','failed');
 return jsonb_build_object('recorded',true);
end $$;

-- Remove private response text after 90 days but retain tombstone keys so a
-- very late retry can never recreate a completed action. Old session context
-- expires too; the owner-controlled legacy history retains its own policy.
create function public.prune_synqme_cognitive_history() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 with expired as(select user_id,training_revision,turn_key from public.synqme_cognitive_turns where updated_at<now()-interval '90 days' and status='completed' and result ? 'reply' limit 500 for update skip locked)
 update public.synqme_cognitive_turns t set result='{"expired":true}'::jsonb from expired e where t.user_id=e.user_id and t.training_revision=e.training_revision and t.turn_key=e.turn_key;
 get diagnostics changed=row_count;
 delete from public.synqme_cognitive_sessions where updated_at<now()-interval '90 days' and (lease_until is null or lease_until<now());
 delete from public.synqme_memory_jobs where server_owned and status='done' and updated_at<now()-interval '30 days';
 delete from public.synqme_cognitive_deliveries where observed_at<now()-interval '90 days';
 return jsonb_build_object('responses_redacted',changed);
end $$;
revoke all on function public.record_synqme_cognitive_delivery(uuid,bigint,text,text,text,text,integer),public.prune_synqme_cognitive_history() from public,anon,authenticated;
grant execute on function public.record_synqme_cognitive_delivery(uuid,bigint,text,text,text,text,integer),public.prune_synqme_cognitive_history() to service_role;
