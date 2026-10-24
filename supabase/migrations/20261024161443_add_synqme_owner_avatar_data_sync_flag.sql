alter table public.synqme_profiles
  add column if not exists owner_avatar_data text,
  add column if not exists owner_avatar_synced boolean not null default false;
