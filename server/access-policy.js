import { randomUUID } from 'node:crypto';

const ACTIVE = new Set(['active', 'canceled', 'grace', 'test']);
const KINDS = new Set(['chat', 'memory', 'knowledge', 'simulation', 'break_prompt', 'cognitive_delivery']);

function failure(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function evaluateMssEntitlement({ settings, entitlement, usage, now = Date.now(), enabledByServer = false } = {}) {
  const trialLimitUsd = clamp(settings?.free_trial_limit_usd ?? 0.10);
  const reviewThresholdUsd = clamp(settings?.review_threshold_usd ?? 1);
  const trialUsedUsd = clamp(usage?.used_usd);
  const trialRemainingUsd = Math.max(0, trialLimitUsd - trialUsedUsd);
  const enforcementEnabled = enabledByServer && settings?.enforcement_enabled === true;
  const premiumActive = Boolean(entitlement && ACTIVE.has(entitlement.status) &&
    Date.parse(entitlement.valid_until || '') > now);
  const legacyMode = !enforcementEnabled;
  const trialEligible = !entitlement && trialRemainingUsd > 0;
  const canChat = legacyMode || premiumActive || trialEligible;
  const canTalk = legacyMode || premiumActive;
  return {
    enforcementEnabled, premiumActive, canChat, canTalk,
    mode: legacyMode ? 'legacy' : premiumActive ? 'premium' : trialEligible ? 'trial' :
      entitlement ? 'subscription_required' : 'free_trial_exhausted',
    subscriptionStatus: entitlement?.status || 'none',
    validUntil: entitlement?.valid_until || null,
    trialLimitUsd, trialUsedUsd, trialRemainingUsd,
    reviewThresholdUsd
  };
}

export function createMssAccessPolicy({ db, enforcementEnabled = false, betaEmails = [] } = {}) {
  const testers = new Set(Array.from(betaEmails, v => String(v).trim().toLowerCase()).filter(Boolean));

  async function ensureBeta(user) {
    if (!db || !testers.has(String(user?.email || '').trim().toLowerCase())) return;
    const { data, error } = await db.from('mss_subscription_entitlements')
      .select('status').eq('user_id', user.id).maybeSingle();
    if (error) throw failure('Subscription status is unavailable.',503,'entitlement_unavailable');
    if (data) return;
    const until = new Date(Date.now() + 180 * 86400000).toISOString();
    const inserted = await db.from('mss_subscription_entitlements').upsert({
      user_id:user.id,provider:'beta',status:'test',valid_until:until,last_verified_at:new Date().toISOString()
    },{onConflict:'user_id',ignoreDuplicates:true});
    if (inserted.error) throw failure('Test account entitlement is unavailable.',503,'entitlement_unavailable');
  }

  async function status(user) {
    if (!db) throw failure('Subscription status is unavailable.',503,'entitlement_unavailable');
    await ensureBeta(user);
    const [s,e,u] = await Promise.all([
      db.from('mss_access_settings').select('enforcement_enabled,free_trial_limit_usd,review_threshold_usd').eq('id',1).single(),
      db.from('mss_subscription_entitlements').select('status,valid_until,provider').eq('user_id',user.id).maybeSingle(),
      db.from('mss_free_chat_usage').select('used_usd').eq('user_id',user.id).maybeSingle()
    ]);
    if (s.error || e.error || u.error || !s.data) throw failure('Subscription status is temporarily unavailable.',503,'entitlement_unavailable');
    return evaluateMssEntitlement({settings:s.data,entitlement:e.data,usage:u.data,enabledByServer:enforcementEnabled});
  }

  async function requireVoice(user) {
    if (!enforcementEnabled) return {mode:'legacy',canTalk:true,enforcementEnabled:false};
    const access = await status(user);
    if (!access.canTalk) throw failure('Premium is required for voice. Subscribe to continue training.',402,'subscription_required');
    return access;
  }

  async function reserve(user, kind = 'chat') {
    if (!KINDS.has(kind)) throw failure('Unsupported conversation operation.',400,'invalid_request');
    if (!enforcementEnabled) return null;
    const access = await status(user);
    if (!access.enforcementEnabled) return null;
    if (!access.canChat) {
      const code = access.mode === 'free_trial_exhausted' ? 'free_trial_exhausted' : 'subscription_required';
      throw failure(code === 'free_trial_exhausted'
        ? 'Your free $0.10 chat trial is complete. Subscribe to keep training.'
        : 'Your Premium subscription is inactive. Renew to continue training.',402,code);
    }
    const requestId = randomUUID();
    const {data,error} = await db.rpc('mss_reserve_chat_request',{
      p_user_id:user.id,p_request_id:requestId,p_kind:kind
    });
    if (error) throw failure('Chat allowance could not be checked. Please retry.',503,'allowance_unavailable');
    if (data?.allowed !== true) {
      const code = String(data?.code || 'allowance_unavailable');
      const limited = code === 'rate_limited' || code === 'concurrent_limit';
      const message = code === 'free_trial_exhausted' ?
        'Your free $0.10 chat trial is complete. Subscribe to keep training.' :
        code === 'premium_required_for_feature' ? 'This feature requires Premium.' :
        code === 'subscription_required' ? 'Renew Premium to continue training.' :
        limited ? 'Too many simultaneous or rapid requests. Try again shortly.' :
        'Your chat allowance could not be checked.';
      throw failure(message,limited ? 429 : ['subscription_required','free_trial_exhausted','premium_required_for_feature'].includes(code)?402:503,code);
    }
    return {requestId,userId:user.id,mode:data.mode || access.mode,kind};
  }

  async function recordCost(slot, operation, estimatedCostUsd) {
    if (!slot || !db) return;
    const amount = clamp(estimatedCostUsd);
    const {error} = await db.rpc('mss_record_chat_cost',{
      p_user_id:slot.userId,p_request_id:slot.requestId,
      p_operation:String(operation || 'chat').slice(0,80),p_cost_usd:amount
    });
    if (error) {
      console.error('MSS trusted chat cost ledger unavailable',{code:error.code || 'unknown'});
      throw failure('Chat usage could not be recorded.',503,'chat_cost_unavailable');
    }
  }

  async function release(slot) {
    if (!slot || !db) return;
    const {error} = await db.rpc('mss_release_chat_request',{
      p_user_id:slot.userId,p_request_id:slot.requestId
    });
    if (error) console.warn('MSS chat reservation release failed',{code:error.code || 'unknown'});
  }

  async function recordVerifiedSubscription(userId,purchase) {
    if (!db || purchase.kind !== 'subscription' || !purchase.periodEnd) return;
    const hash = purchase.tokenHash || null;
    const {error} = await db.from('mss_subscription_entitlements').upsert({
      user_id:userId,provider:'google_play',status:purchase.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ? 'grace' :
        purchase.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED' ? 'canceled' : 'active',
      valid_until:purchase.periodEnd,
      ...(hash ? {purchase_token_hash:hash} : {}),
      last_verified_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if (error) throw failure('Subscription entitlement could not be saved.',503,'entitlement_write_failed');
  }

  return {status,requireVoice,reserve,recordCost,release,recordVerifiedSubscription};
}
