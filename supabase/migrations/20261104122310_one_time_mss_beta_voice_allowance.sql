-- Apply one 60-minute, non-expiring beta credit allocation per eligible account.
-- The server allowlist gates eligibility; this RPC is service-role-only and atomic.
create table if not exists public.mss_voice_beta_allowances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minutes_granted integer not null default 60 check (minutes_granted = 60),
  granted_at timestamptz not null default now()
);
alter table public.mss_voice_beta_allowances enable row level security;
revoke all on public.mss_voice_beta_allowances from public, anon, authenticated;
grant select, insert on public.mss_voice_beta_allowances to service_role;
create or replace function public.mss_grant_beta_voice_allowance(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path to ''
as $$
declare v_new_grant uuid;
begin
  if p_user_id is null then raise exception 'invalid_beta_user'; end if;
  insert into public.mss_voice_beta_allowances (user_id,minutes_granted)
  values(p_user_id,60)
  on conflict (user_id) do nothing returning user_id into v_new_grant;
  if v_new_grant is null then return false; end if;
  insert into public.mss_voice_wallets (user_id,topup_remaining_ms)
  values(p_user_id,3600000::bigint)
  on conflict (user_id) do update set
    topup_remaining_ms=public.mss_voice_wallets.topup_remaining_ms+3600000::bigint,
    updated_at=now();
  return true;
end;
$$;
revoke all on function public.mss_grant_beta_voice_allowance(uuid) from public, anon, authenticated;
grant execute on function public.mss_grant_beta_voice_allowance(uuid) to service_role;
