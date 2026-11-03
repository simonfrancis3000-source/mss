export function voiceBalanceModel(wallet, now = Date.now()) {
  const end = Date.parse(wallet?.monthlyValidUntil || '');
  const active = wallet?.premiumActive === true && Number.isFinite(end) && end > now;
  const safe = value => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
  const monthly = active ? safe(wallet.monthlyRemainingMs) : 0;
  const topup = safe(wallet?.topupRemainingMs);
  const label = ms => ms > 0 && ms < 60000 ? 'Less than 1 min' : Math.floor(ms / 60000) + ' min';
  return { active, isTest:active && wallet?.allowanceType === "test", monthly, topup, total: label(monthly + topup), monthlyLabel: label(monthly), topupLabel: label(topup),
    remainingPercent: Math.min(100, monthly / 3600000 * 100), periodEnd: active ? new Date(end).toISOString() : null };
}

// Only requests on Profile entry/refresh. No background polling or cross-account cache.
export function createVoiceBalance({apiBase, getUserId, getHeaders, onChange, fetcher = fetch}) {
  let account = null, value = null, status = 'idle', pending = null, generation = 0;
  function snapshot() {
    return account && account === getUserId() ? {status, wallet:value} : {status:'idle',wallet:null};
  }
  async function refresh() {
    const owner = getUserId();
    if (!owner) { generation++;account=null;value=null;status='idle';pending=null;onChange();return; }
    if (account === owner && pending) return pending;
    const version=++generation;
    account=owner;value=null;status='loading';onChange();
    const request = (async()=>{
      try {
        const headers = await getHeaders();
        if (owner !== getUserId()) return;
        const response=await fetcher(apiBase+'/api/billing/status',{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw Error('balance_unavailable');
        const wallet=await response.json();
        if (owner !== getUserId() || account !== owner || version !== generation) return;
        value=wallet;status='ready';
      } catch {
        if(owner!==getUserId() || account!==owner || version!==generation)return;
        value=null;status='error';
      } finally {
        if(version===generation && account===owner && owner===getUserId()){pending=null;onChange();}
      }
    })();
    pending=request;return request;
  }
  return {snapshot,refresh};
}
