import { randomUUID } from 'node:crypto';
import { obfuscatedPlayAccountId } from './google-play-billing.js';

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

export function evaluateMssEntitlement({
  settings, entitlement, usage, premiumAllowance, now = Date.now(), enabledByServer = false
} = {}) {
  const trialLimitUsd = clamp(settings?.free_trial_limit_usd ?? 0.10);
  const trialUsedUsd = clamp(usage?.used_usd);
  const trialRemainingUsd = Math.max(0, trialLimitUsd - trialUsedUsd);
  const enforcementEnabled = enabledByServer && settings?.enforcement_enabled === true;
  const premiumActive = Boolean(entitlement && ACTIVE.has(entitlement.status) &&
    Date.parse(entitlement.valid_until || '') > now);
  const premiumBaseUsd = clamp(settings?.premium_limit_usd ?? 0.50);
  const premiumLimitUsd = Math.max(premiumBaseUsd, clamp(premiumAllowance?.limitUsd || premiumBaseUsd));
  const premiumUsedUsd = clamp(premiumAllowance?.usedUsd);
  const premiumBonusUsd = clamp(premiumAllowance?.bonusUsd);
  const premiumRemainingUsd = Math.max(0, premiumLimitUsd - premiumUsedUsd);
  const premiumHardStop = premiumActive && premiumUsedUsd >= premiumLimitUsd;
  const legacyMode = !enforcementEnabled;
  const trialEligible = !entitlement && trialRemainingUsd > 0;
  const canChat = legacyMode || (premiumActive && !premiumHardStop) || trialEligible;
  const canTalk = legacyMode || (premiumActive && !premiumHardStop);
  return {
    enforcementEnabled, premiumActive, premiumHardStop, canChat, canTalk,
    mode: legacyMode ? 'legacy' : premiumActive ?
      (premiumHardStop ? 'premium_chat_exhausted' : 'premium') :
      trialEligible ? 'trial' :
      entitlement ? 'subscription_required' : 'free_trial_exhausted',
    subscriptionStatus: entitlement?.status || 'none',
    validUntil: entitlement?.valid_until || null,
    trialLimitUsd, trialUsedUsd, trialRemainingUsd,
    premiumBaseUsd, premiumBonusUsd, premiumLimitUsd,
    premiumUsedUsd, premiumRemainingUsd,
    premiumPeriodStart: premiumAllowance?.periodStart || null,
    premiumPeriodEnd: premiumAllowance?.periodEnd || null
  };
}

export function createMssAccessPolicy({ db, enforcementEnabled = false, betaEmails = [] } = {}) {
  const testers = new Set(Array.from(betaEmails, v => String(v).trim().toLowerCase()).filter(Boolean));
  const linkedAccounts = new Set();

  async function linkPlayAccount(user) {
    if (!db || !user?.id || linkedAccounts.has(user.id)) return;
    const obfuscatedId = obfuscatedPlayAccountId(user.id);
    const {error} = await db.from('mss_play_account_links').upsert({
      user_id:user.id,obfuscated_account_id:obfuscatedId,checked_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if (error) throw failure('Google Play account linkage is unavailable.',503,'account_link_unavailable');
    linkedAccounts.add(user.id);
  }

  async function ensureBeta(user) {
    if (!db || !testers.has(String(user?.email || '').trim().toLowerCase())) return;
    const { data, error } = await db.from('mss_subscription_entitlements')
      .select('status').eq('user_id', user.id).maybeSingle();
    if (error) throw failure('Subscription status is unavailable.',503,'entitlement_unavailable');
    if (data) return;
    const until = new Date(Date.now() + 180 * 86400000).toISOString();
    const inserted = await db.from('mss_subscription_entitlements').upsert({
      user_id:user.id,provider:'beta',status:'test',period_start:new Date().toISOString(),valid_until:until,last_verified_at:new Date().toISOString()
    },{onConflict:'user_id',ignoreDuplicates:true});
    if (inserted.error) throw failure('Test account entitlement is unavailable.',503,'entitlement_unavailable');
  }

  async function status(user) {
    if (!db) throw failure('Subscription status is unavailable.',503,'entitlement_unavailable');
    await ensureBeta(user);
    await linkPlayAccount(user);
    const [s,e,u,cap] = await Promise.all([
      db.from('mss_access_settings').select('enforcement_enabled,free_trial_limit_usd,premium_limit_usd').eq('id',1).single(),
      db.from('mss_subscription_entitlements').select('status,valid_until,provider,period_start').eq('user_id',user.id).maybeSingle(),
      db.from('mss_free_chat_usage').select('used_usd').eq('user_id',user.id).maybeSingle(),
      db.rpc('mss_get_chat_allowance',{p_user_id:user.id})
    ]);
    if (s.error || e.error || u.error || cap.error || !s.data) {
      throw failure('Subscription status is temporarily unavailable.',503,'entitlement_unavailable');
    }
    return evaluateMssEntitlement({
      settings:s.data,entitlement:e.data,usage:u.data,
      premiumAllowance:cap.data,enabledByServer:enforcementEnabled
    });
  }

  async function requireVoice(user) {
    if (!enforcementEnabled) return {mode:'legacy',canTalk:true,enforcementEnabled:false};
    const access = await status(user);
    if (!access.canTalk) {
      const capped = access.mode === 'premium_chat_exhausted';
      throw failure(capped
        ? 'Your $0.50 Premium chat allowance is exhausted. Purchase a voice-minute pack or wait for subscription renewal.'
        : 'Premium is required for voice. Subscribe to continue training.',402,
      capped ? 'premium_chat_exhausted' : 'subscription_required');
    }
    return access;
  }

  async function reserve(user, kind = 'chat') {
    if (!KINDS.has(kind)) throw failure('Unsupported conversation operation.',400,'invalid_request');
    if (!enforcementEnabled) return null;
    const access = await status(user);
    if (!access.enforcementEnabled) return null;
    if (!access.canChat) {
      const code = access.mode === 'free_trial_exhausted' ? 'free_trial_exhausted' :
        access.mode === 'premium_chat_exhausted' ? 'premium_chat_exhausted' : 'subscription_required';
      throw failure(code === 'free_trial_exhausted'
        ? 'Your free $0.10 chat trial is complete. Subscribe to keep training.'
        : code === 'premium_chat_exhausted'
          ? 'Your $0.50 Premium chat allowance is exhausted. Purchase a voice-minute pack or wait for your monthly renewal.'
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
        code === 'premium_chat_exhausted' ? 'Your $0.50 chat allowance is used. Purchase a voice-minute pack or wait for renewal.' :
        limited ? 'Too many simultaneous or rapid requests. Try again shortly.' :
        'Your chat allowance could not be checked.';
      throw failure(message,limited ? 429 : ['subscription_required','free_trial_exhausted','premium_required_for_feature','premium_chat_exhausted'].includes(code)?402:503,code);
    }
    return {requestId,userId:user.id,mode:data.mode || access.mode,kind};
  }

  async function recordCost(slot, operation, estimatedCostUsd, providerRequestId) {
    if (!slot || !db) return;
    const amount = Number(estimatedCostUsd);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1 ||
        !/^[a-f0-9-]{36}$/i.test(String(providerRequestId || ''))) {
      throw failure('AI provider usage could not be measured.',503,'chat_cost_unavailable');
    }
    const {error} = await db.rpc('mss_record_chat_cost',{
      p_user_id:slot.userId,p_request_id:slot.requestId,
      p_operation:String(operation || 'chat').slice(0,80),
      p_cost_usd:amount,p_provider_request_id:providerRequestId
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

  // Called only after backend verification with the Google Play Developer API.
  // The order/expiry pair identifies the actual billing period; repeated
  // receipt restoration never resets the user's $0.50 usage allowance.
  async function recordVerifiedSubscription(userId,purchase) {
    if (!db || purchase.kind !== 'subscription' || !purchase.periodEnd) return;
    return recordVerifiedSubscriptionStatus(userId, {
      state:purchase.subscriptionState,
      periodEnd:purchase.periodEnd,
      tokenHash:purchase.tokenHash,
      orderId:purchase.orderId || ''
    });
  }

  async function recordVerifiedSubscriptionStatus(userId, {state,periodEnd,tokenHash,orderId}={}) {
    if (!db || !userId || !/^[a-f0-9]{64}$/.test(String(tokenHash || ''))) {
      throw failure('Verified subscription information is incomplete.',503,'entitlement_write_failed');
    }
    const statusMap = {
      SUBSCRIPTION_STATE_ACTIVE:'active',
      SUBSCRIPTION_STATE_CANCELED:'canceled',
      SUBSCRIPTION_STATE_IN_GRACE_PERIOD:'grace',
      SUBSCRIPTION_STATE_ON_HOLD:'hold',
      SUBSCRIPTION_STATE_PAUSED:'hold',
      SUBSCRIPTION_STATE_EXPIRED:'expired',
      SUBSCRIPTION_STATE_PENDING:'pending',
      SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED:'revoked'
    };
    const stateStatus = statusMap[state];
    if (!stateStatus) throw failure('Unknown Google Play subscription state.',503,'entitlement_state_unknown');
    const newEnd = Date.parse(periodEnd || '');
    // Pending purchases can have no expiry. No access is granted until Play
    // reports a verified paid billing period.
    const currentlyInactive = ['hold','expired','revoked','pending'].includes(stateStatus);
    if (!Number.isFinite(newEnd) && !currentlyInactive) {
      throw failure('Google Play billing period is unavailable.',503,'entitlement_write_failed');
    }
    const {data:old,error:oldError} = await db.from('mss_subscription_entitlements')
      .select('provider,status,period_start,valid_until,purchase_token_hash,latest_order_id')
      .eq('user_id',userId).maybeSingle();
    if (oldError) throw failure('Subscription state could not be checked.',503,'entitlement_write_failed');
    const previousEnd = Date.parse(old?.valid_until || '');
    const now = Date.now();
    const sameToken = old?.provider === 'google_play' && old.purchase_token_hash === tokenHash;
    if (old?.provider === 'google_play' && Number.isFinite(previousEnd) &&
        (!Number.isFinite(newEnd) || previousEnd > newEnd) &&
        (!sameToken || !currentlyInactive)) {
      return {updated:false,newPeriod:false,reason:'stale_period'};
    }
    const effectiveEnd = Number.isFinite(newEnd) && (!currentlyInactive || !Number.isFinite(previousEnd))
      ? new Date(newEnd).toISOString()
      : Number.isFinite(previousEnd) ? new Date(previousEnd).toISOString() : new Date(now).toISOString();
    const samePeriod = old?.provider === 'google_play' && previousEnd === Date.parse(effectiveEnd);
    const renewed = Boolean(old?.provider === 'google_play' && Number.isFinite(previousEnd) &&
      Date.parse(effectiveEnd) > previousEnd && !currentlyInactive);
    const periodStart = samePeriod && old.period_start ? old.period_start :
      renewed ? new Date(previousEnd).toISOString() :
      new Date(now).toISOString();

    // Even inactive subscriptions need a token-to-account association, so
    // future verified RTDN events can recover the account after a hold.
    const {error:bindError} = await db.from('mss_play_purchase_tokens')
      .upsert({token_hash:tokenHash,user_id:userId},{onConflict:'token_hash',ignoreDuplicates:true});
    if (bindError) throw failure('Verified purchase ownership could not be saved.',503,'entitlement_write_failed');
    const {data:owner,error:ownerError} = await db.from('mss_play_purchase_tokens')
      .select('user_id').eq('token_hash',tokenHash).maybeSingle();
    if (ownerError || owner?.user_id !== userId) {
      throw failure('Verified purchase belongs to a different account.',403,'purchase_account_mismatch');
    }
    const {error} = await db.from('mss_subscription_entitlements').upsert({
      user_id:userId,provider:'google_play',status:stateStatus,
      period_start:periodStart,valid_until:effectiveEnd,
      purchase_token_hash:tokenHash,
      latest_order_id:String(orderId || (samePeriod ? old?.latest_order_id || '' : '')).slice(0,180),
      last_verified_at:new Date(now).toISOString(),
      updated_at:new Date(now).toISOString()
    },{onConflict:'user_id'});
    if (error) throw failure('Verified subscription could not be saved.',503,'entitlement_write_failed');
    return {updated:true,newPeriod:renewed,periodStart,periodEnd:effectiveEnd,status:stateStatus};
  }

  async function recordVerifiedTopup(userId, purchase) {
    if (!db || purchase.kind !== 'topup' || !purchase.tokenHash) return {granted:false};
    const {data:entitlement,error:eError} = await db.from('mss_subscription_entitlements')
      .select('status,valid_until,period_start').eq('user_id',userId).maybeSingle();
    if (eError) throw failure('Subscription could not be checked for chat credits.',503,'chat_bonus_unavailable');
    if (!entitlement || !ACTIVE.has(entitlement.status) ||
        Date.parse(entitlement.valid_until || '') <= Date.now()) return {granted:false};
    const periodStart = entitlement.period_start;
    if (!periodStart) return {granted:false};

    // A pack must have been verified and first credited during this paid
    // period. Replaying old consumable receipts cannot mint more chat credit.
    const {data:grant,error:gError} = await db.from('mss_voice_credit_grants')
      .select('user_id,created_at,product_id').eq('user_id',userId)
      .eq('token_hash',purchase.tokenHash).eq('product_id',purchase.productId)
      .order('created_at',{ascending:true}).limit(1);
    if (gError) throw failure('Voice credit receipt could not be checked.',503,'chat_bonus_unavailable');
    if (!grant?.length || Date.parse(grant[0].created_at) < Date.parse(periodStart)) {
      return {granted:false};
    }
    const {error} = await db.from('mss_chat_bonus_grants').upsert({
      token_hash:purchase.tokenHash,user_id:userId,period_start:periodStart,
      product_id:purchase.productId,bonus_usd:0.5
    },{onConflict:'token_hash',ignoreDuplicates:true});
    if (error) throw failure('Extra chat allowance could not be credited.',503,'chat_bonus_unavailable');
    return {granted:true,bonusUsd:0.5};
  }

  return {status,requireVoice,reserve,recordCost,release,recordVerifiedSubscription,recordVerifiedSubscriptionStatus,recordVerifiedTopup};
}
