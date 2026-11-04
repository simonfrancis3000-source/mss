// Account-scoped read of verified monetary robot rewards.
// This is separate from the voice-minute wallet: free test minutes earn nothing.
export function createRobotRewardBalance({apiBase,getUserId,getHeaders,onChange,fetcher=fetch}) {
  let owner=null, value=null, status='idle', pending=null, version=0;
  function snapshot() {
    return owner && owner === getUserId()
      ? {status,...(value || {})}
      : {status:'idle',earnedCents:null};
  }
  async function refresh() {
    const id=getUserId();
    if (!id) { version++;owner=null;value=null;status='idle';pending=null;onChange?.();return; }
    if (id === owner && pending) return pending;
    const token=++version;
    owner=id;status='loading';onChange?.();
    const request=(async()=>{
      try {
        const headers=await getHeaders();
        if (id !== getUserId()) return;
        const response=await fetcher(apiBase+'/api/rewards/status',{
          headers,cache:'no-store',signal:AbortSignal.timeout(15000)
        });
        if (!response.ok) throw Error('rewards_unavailable');
        const next=await response.json();
        if (id !== getUserId() || owner !== id || token !== version) return;
        value=next;
        status=next.status === 'ready' ? 'ready' : 'pending';
      } catch {
        if (id !== getUserId() || owner !== id || token !== version) return;
        status=value?.status === 'ready' ? 'ready' : 'error';
      } finally {
        if (token===version && owner===id && id===getUserId()){pending=null;onChange?.();}
      }
    })();
    pending=request;
    return request;
  }
  return {snapshot,refresh};
}
