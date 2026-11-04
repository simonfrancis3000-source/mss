create table if not exists public.synqme_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 0 check (version between 0 and 1000),
  outcome text not null default 'pending' check (outcome in ('pending','completed','skipped','existing_user')),
  dismissed_at timestamptz,
  intro_presented_at timestamptz,
  created_at timestamptz not null default now(),
  constraint onboarding_dismissal_valid check ((outcome = 'pending' and dismissed_at is null) or (outcome <> 'pending' and dismissed_at is not null))
);
alter table public.synqme_onboarding enable row level security;
revoke all on table public.synqme_onboarding from public, anon, authenticated;
grant select, insert, update on table public.synqme_onboarding to authenticated;
grant all on table public.synqme_onboarding to service_role;
create policy onboarding_select_own on public.synqme_onboarding for select to authenticated using ((select auth.uid()) = user_id);
create policy onboarding_insert_own on public.synqme_onboarding for insert to authenticated with check ((select auth.uid()) = user_id);
create policy onboarding_update_own on public.synqme_onboarding for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
