-- Ensure a voice lease is never reserved for less than one second.
create or replace function public.mss_reserve_voice_lease(
  p_user_id uuid, p_lease_id uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_wallet public.mss_voice_wallets%rowtype;
  v_remaining_monthly bigint;
  v_remaining_topup bigint;
  v_total bigint;
  v_monthly bigint;
  v_topup bigint;
  v_expiry_cap bigint;
  v_stale public.mss_voice_leases%rowtype;
begin
  if p_user_id is null or p_lease_id is null then
    raise exception 'invalid_lease_identity';
  end if;
  -- Unknown accounts do not receive free voice credit.
  select * into v_wallet from public.mss_voice_wallets
    where user_id = p_user_id for update;
  if not found then raise exception 'no_voice_credits'; end if;

  -- A Render restart can interrupt settlement. Reclaim only leases that
  -- passed the server's absolute connection deadline, conservatively
  -- refunding all reserved minutes rather than charging for a crashed call.
  for v_stale in select * from public.mss_voice_leases
    where user_id = p_user_id and status = 'active'
      and connection_deadline < now() for update loop
    update public.mss_voice_leases set status='settled',
      consumed_ms=0, settled_at=now() where id=v_stale.id;
    update public.mss_voice_wallets set
      monthly_remaining_ms=monthly_remaining_ms +
        case when monthly_valid_until > now() then v_stale.reserved_monthly_ms else 0 end,
      topup_remaining_ms=topup_remaining_ms + v_stale.reserved_topup_ms,
      updated_at=now()
      where user_id=p_user_id;
  end loop;
  -- Refresh wallet after stale lease refunds.
  select * into v_wallet from public.mss_voice_wallets
    where user_id=p_user_id for update;
  if exists(select 1 from public.mss_voice_leases
    where user_id = p_user_id and status = 'active') then
    raise exception 'voice_session_already_active';
  end if;

  v_remaining_monthly := case when v_wallet.monthly_valid_until > now()
    then v_wallet.monthly_remaining_ms else 0 end;
  v_remaining_topup := v_wallet.topup_remaining_ms;
  v_total := least(300000::bigint, v_remaining_monthly + v_remaining_topup);
  if v_total <= 0 then raise exception 'no_voice_credits'; end if;
  -- Do not reserve monthly minutes beyond subscription expiration. Purchased
  -- top-ups remain spendable even after the Premium billing period expires.
  v_expiry_cap := case when v_remaining_monthly > 0 then greatest(0::bigint,
    floor(extract(epoch from (v_wallet.monthly_valid_until - now())) * 1000)::bigint)
    else 300000 end;
  if v_expiry_cap <= 0 then
    v_remaining_monthly := 0;
    v_total := least(300000::bigint, v_remaining_topup);
  else
    v_total := least(v_total, v_expiry_cap);
  end if;
  if v_total < 1000 then raise exception 'no_voice_credits'; end if;

  v_monthly := least(v_remaining_monthly, v_total);
  v_topup := v_total - v_monthly;
  update public.mss_voice_wallets set
    monthly_remaining_ms = case when monthly_valid_until > now()
      then monthly_remaining_ms - v_monthly else 0 end,
    topup_remaining_ms = topup_remaining_ms - v_topup,
    updated_at = now()
    where user_id = p_user_id;

  insert into public.mss_voice_leases
    (id, user_id, reserved_monthly_ms, reserved_topup_ms, connection_deadline)
    values (p_lease_id, p_user_id, v_monthly, v_topup, now() + interval '7 minutes');

  return jsonb_build_object('leaseId',p_lease_id,'reservedMs',v_total);
end $$;

