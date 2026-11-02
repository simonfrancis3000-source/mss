-- Owner-controlled reminders, separate from scenario training and persona rules.
create table public.synqme_reminders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(btrim(title)) between 3 and 500),
 completed boolean not null default false,
 scenario_id text check (scenario_id is null or (char_length(scenario_id) <= 120 and scenario_id ~ '^(room|outside):[a-z0-9_:-]+$')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index synqme_reminders_owner_status on public.synqme_reminders(user_id, completed, created_at desc);
alter table public.synqme_reminders enable row level security;
revoke all on public.synqme_reminders from public, anon, authenticated;
grant select, insert, update, delete on public.synqme_reminders to authenticated;
create policy reminders_owner on public.synqme_reminders for all to authenticated
 using ((select auth.uid()) = user_id and coalesce((select auth.jwt()->>'is_anonymous')::boolean,false) = false)
 with check ((select auth.uid()) = user_id and coalesce((select auth.jwt()->>'is_anonymous')::boolean,false) = false);
