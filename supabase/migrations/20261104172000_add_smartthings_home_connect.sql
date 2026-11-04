-- SmartThings read-only device discovery. All OAuth credentials are server-only.
create table if not exists public.mss_smartthings_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists mss_smartthings_oauth_states_user_idx
  on public.mss_smartthings_oauth_states(user_id, expires_at);

create table if not exists public.mss_smartthings_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  installed_app_id text,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz not null,
  granted_scopes text[] not null default array[]::text[],
  devices jsonb not null default '[]'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mss_smartthings_devices_array check (jsonb_typeof(devices) = 'array')
);

alter table public.mss_smartthings_oauth_states enable row level security;
alter table public.mss_smartthings_connections enable row level security;
-- Browser clients must never read OAuth state or encrypted tokens.
revoke all on public.mss_smartthings_oauth_states from anon, authenticated;
revoke all on public.mss_smartthings_connections from anon, authenticated;
grant select, insert, update, delete on public.mss_smartthings_oauth_states to service_role;
grant select, insert, update, delete on public.mss_smartthings_connections to service_role;
