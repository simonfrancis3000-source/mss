import { ONBOARDING_VERSION, shouldShowOnboarding } from './getting-started-content.js';

export function supabaseOnboardingRepository(client) {
  const table = () => client.from('synqme_onboarding');
  const check = result => { if (result.error) throw result.error; return result.data; };
  return {
    async read(userId) { return check(await table().select('*').eq('user_id', userId).maybeSingle()); },
    async create(record) {
      const data = check(await table().upsert(record, { onConflict: 'user_id', ignoreDuplicates: true }).select('*').maybeSingle());
      return data || this.read(record.user_id);
    },
    async dismiss(userId, patch) { return check(await table().update(patch).eq('user_id', userId).select('*').single()); },
    async claimIntroduction(userId, timestamp) {
      return check(await table().update({ intro_presented_at: timestamp }).eq('user_id', userId).is('intro_presented_at', null).select('*').maybeSingle());
    }
  };
}

export function createOnboardingState({ repository, storage, onChange = () => {}, now = () => new Date().toISOString() }) {
  let state = { userId: null, status: 'idle', record: null, returning: false, syncPending: false };
  let generation = 0, lastClaim = null;
  const cacheKey = id => 'mss-onboarding:' + id;
  function cached(id) {
    try {
      const value = JSON.parse(storage?.getItem(cacheKey(id)) || 'null');
      return value?.user_id === id && Number.isInteger(value.version) && value.version >= 0 && value.version <= ONBOARDING_VERSION && ['pending', 'completed', 'skipped', 'existing_user'].includes(value.outcome) ? value : null;
    } catch { return null; }
  }
  function remember(record) { try { storage?.setItem(cacheKey(record.user_id), JSON.stringify(record)); } catch {} }
  function publish(next) { state = { ...state, ...next }; onChange(); }
  async function load(userId, { returning = false } = {}) {
    const token = ++generation; lastClaim = null;
    publish({ userId, status: userId ? 'loading' : 'idle', record: null, returning, syncPending: false });
    if (!userId) return;
    try {
      let record = await repository.read(userId);
      if (token !== generation) return;
      if (!record) record = await repository.create({ user_id: userId, version: returning ? ONBOARDING_VERSION : 0, outcome: returning ? 'existing_user' : 'pending', dismissed_at: returning ? now() : null, intro_presented_at: returning ? now() : null });
      if (token !== generation) return;
      const local = cached(userId);
      if (local?.version > record.version) record = await repository.dismiss(userId, { version: local.version, outcome: local.outcome, dismissed_at: local.dismissed_at });
      if (token !== generation) return;
      if (returning && record.version === 0) record = await repository.dismiss(userId, { version: ONBOARDING_VERSION, outcome: 'existing_user', dismissed_at: now(), intro_presented_at: record.intro_presented_at || now() });
      if (token !== generation) return;
      remember(record); publish({ status: 'ready', record });
    } catch {
      if (token === generation) publish({ status: 'error', record: cached(userId), syncPending: true });
    }
  }
  async function dismiss(outcome) {
    if (!['completed', 'skipped'].includes(outcome) || !state.userId) return { saved: false };
    const token = generation, userId = state.userId;
    if (outcome === 'skipped' && state.record?.version >= ONBOARDING_VERSION) return { saved: true };
    const patch = { version: ONBOARDING_VERSION, outcome, dismissed_at: now() };
    const local = { ...(state.record || { user_id: userId, intro_presented_at: null }), ...patch };
    remember(local); publish({ record: local });
    try {
      if (state.status !== 'ready') await repository.create({ user_id: userId, version: 0, outcome: 'pending', dismissed_at: null, intro_presented_at: null });
      if (token !== generation) return { saved: false };
      const record = await repository.dismiss(userId, patch);
      if (token !== generation) return { saved: false };
      remember(record); publish({ status: 'ready', record, syncPending: false }); return { saved: true };
    } catch {
      if (token === generation) publish({ syncPending: true });
      return { saved: false };
    }
  }
  async function claimIntroduction(turnKey) {
    const userId = state.userId, token = generation;
    if (!userId || state.status !== 'ready' || state.returning) return false;
    if (lastClaim?.userId === userId && lastClaim.turnKey === turnKey) return lastClaim.claimed;
    if (state.record?.intro_presented_at) return false;
    try {
      const record = await repository.claimIntroduction(userId, now());
      if (token !== generation) return false;
      lastClaim = { userId, turnKey, claimed: Boolean(record) };
      if (record) { remember(record); publish({ record }); }
      return Boolean(record);
    } catch { return false; }
  }
  return { load, dismiss, claimIntroduction, snapshot: () => ({ ...state }), shouldShow: profileReady => state.status === 'ready' && shouldShowOnboarding(state.record, { profileReady, returning: state.returning }) };
}
