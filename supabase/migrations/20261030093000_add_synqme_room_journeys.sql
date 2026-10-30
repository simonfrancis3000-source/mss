create table public.synqme_room_journeys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  journey_started_at timestamptz not null default now(),
  active_room_id text not null default 'kitchen'
    check (active_room_id in (
      'kitchen', 'living_room', 'bathroom', 'bedroom', 'laundry_utility',
      'garage_storage', 'dining_room', 'hallway_entry', 'home_office',
      'garden_outdoor', 'guest_room', 'balcony_patio'
    )),
  room_progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(room_progress) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.synqme_room_journeys enable row level security;

revoke all on table public.synqme_room_journeys from anon, authenticated;
grant select, insert, update, delete on table public.synqme_room_journeys to authenticated;

create policy "Users can read their own room journey"
  on public.synqme_room_journeys
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own room journey"
  on public.synqme_room_journeys
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own room journey"
  on public.synqme_room_journeys
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own room journey"
  on public.synqme_room_journeys
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
