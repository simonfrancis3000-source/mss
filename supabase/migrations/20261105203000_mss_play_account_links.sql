-- Trusted mapping from an MSS user to the non-reversible Android Billing account ID.
-- Used to resolve authenticated Google Play renewal/hold notifications even
-- when they arrive before the first on-device receipt reconciliation.
create table if not exists public.mss_play_account_links(
  user_id uuid primary key references auth.users(id) on delete cascade,
  obfuscated_account_id text not null unique check(obfuscated_account_id ~ '^[a-f0-9]{64}$'),
  linked_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);
alter table public.mss_play_account_links enable row level security;
revoke all on public.mss_play_account_links from public,anon,authenticated;
grant all on public.mss_play_account_links to service_role;
create index if not exists mss_play_account_links_obfuscated_id
 on public.mss_play_account_links(obfuscated_account_id);
-- Enforcement is deliberately left disabled until paid-order reconciliation passes.
update public.mss_access_settings set enforcement_enabled=false where id=1;
