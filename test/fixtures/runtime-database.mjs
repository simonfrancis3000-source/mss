import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const OWNER='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
export async function runtimeDatabase() {
  const db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth,public to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
    insert into auth.users values('${OWNER}'),('${OTHER}');
    create table public.synqme_conversations(user_id uuid primary key references auth.users,messages jsonb not null default '[]');
    create table public.synqme_preferences(id uuid primary key default gen_random_uuid(),user_id uuid,preference_status text);
    create table public.synqme_room_journeys(user_id uuid primary key,room_progress jsonb default '{}',active_room_id text,active_task_id text);
    grant select on public.synqme_room_journeys,public.synqme_conversations to authenticated;
    create table public.synqme_training_revisions(user_id uuid primary key references auth.users,revision bigint not null default 0);
    alter table public.synqme_training_revisions enable row level security;
    grant select,insert,update on public.synqme_training_revisions to authenticated;
    create policy owner on public.synqme_training_revisions for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
    create function public.synqme_check_training_revision() returns trigger language plpgsql as $$begin return new;end$$;
  `);
  const files=['supabase/migrations/20261024205230_add_structured_persona_memories.sql','supabase/migrations/20261101113042_amia_decision_storage.sql','docs/todo-reminders.sql','docs/memory-processing-queue.sql','supabase/migrations/20261104145805_amia_cognitive_runtime.sql','supabase/migrations/20261104152117_amia_cognitive_memory_graph.sql'];
  files.push('supabase/migrations/20261104153147_amia_cognitive_delivery_retention.sql');
  files.push('supabase/migrations/20261105111604_amia_cognitive_reset_registered_accounts.sql');
  for(const path of files)await db.exec(await readFile(new URL('../../'+path,import.meta.url),'utf8'));
  await db.exec('set role service_role');
  return db;
}
