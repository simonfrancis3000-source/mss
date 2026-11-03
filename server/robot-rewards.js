// A monetary rewards ledger based only on actual, server-verified Google Play orders.
// Voice-minute entitlements, test allowances, and free trials do not represent payments.
export const REWARD_MONTHLY_CAP_CENTS = 10000;
export const REWARD_LIFETIME_CAP_CENTS = 100000;
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

export function paidUsdCents(money) {
  if (!money || money.currencyCode !== 'USD') return null;
  const units = Number(money.units ?? 0);
  const nanos = Number(money.nanos ?? 0);
  if (!Number.isSafeInteger(units) || units < 0 || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1000000000) return null;
  const result = units * 100 + Math.round(nanos / 10000000);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

export function normalizeGoogleRewardOrder(order, expectedProductId, checkedAt = new Date()) {
  const orderId = String(order?.orderId || '');
  if (!orderId || !/^[a-z\d.\-_:]+$/i.test(orderId)) throw new Error('Invalid Play order identifier');
  const lines = Array.isArray(order.lineItems) ? order.lineItems : [];
  // Only the exact purchased digital SKU in the verified billing grant is eligible.
  if (lines.length !== 1 || lines[0]?.productId !== expectedProductId) throw new Error('Play order product does not match entitlement');
  const money = lines[0]?.total || order.total;
  const currencyCode = String(money?.currencyCode || '');
  const paid = paidUsdCents(money);
  const refunded = ['REFUNDED', 'PARTIALLY_REFUNDED', 'PENDING_REFUND', 'CANCELED'].includes(order.state)
    || Boolean(order.orderHistory?.refundEvent)
    || (order.orderHistory?.partialRefundEvents?.length > 0);
  const status = Boolean(order.testPurchase || order.testPurchaseContext) ? 'test'
    : refunded ? 'refunded'
    : order.state !== 'PROCESSED' ? 'pending'
    : currencyCode !== 'USD' ? 'pending_currency'
    : paid === null || paid === 0 ? 'excluded'
    : 'eligible';
  const createTime = Date.parse(order.createTime || '');
  return {
    order_id: orderId,
    product_id: expectedProductId,
    paid_usd_cents: status === 'eligible' ? paid : 0,
    currency_code: currencyCode || 'unknown',
    status,
    purchased_at: Number.isFinite(createTime) ? new Date(createTime).toISOString() : checkedAt.toISOString(),
    checked_at: checkedAt.toISOString()
  };
}

export function summarizeRobotRewardOrders(orders) {
  let eligibleSpendCents = 0, earnedCents = 0;
  const perMonth = new Map();
  const records = [...(orders || [])].filter(order => order.status === 'eligible'
    && Number.isSafeInteger(order.paid_usd_cents) && order.paid_usd_cents > 0
    && Number.isFinite(Date.parse(order.purchased_at || '')))
    .sort((a, b) => Date.parse(a.purchased_at) - Date.parse(b.purchased_at) || String(a.order_id).localeCompare(String(b.order_id)));
  for (const order of records) {
    const month = new Date(order.purchased_at).toISOString().slice(0, 7);
    eligibleSpendCents += order.paid_usd_cents;
    const availableMonthly = Math.max(0, REWARD_MONTHLY_CAP_CENTS - (perMonth.get(month) || 0));
    const availableLifetime = Math.max(0, REWARD_LIFETIME_CAP_CENTS - earnedCents);
    const earned = Math.min(order.paid_usd_cents * 2, availableMonthly, availableLifetime);
    perMonth.set(month, (perMonth.get(month) || 0) + earned);
    earnedCents += earned;
  }
  return { status: 'ready', earnedCents, capCents: REWARD_LIFETIME_CAP_CENTS,
    availableCents: REWARD_LIFETIME_CAP_CENTS - earnedCents,
    eligibleSpendCents, qualifyingOrders: records.length };
}

// All lookups use grants tied to the authenticated account. This API has no
// client-supplied user or order identifier, and the ledger has no client writes.
export async function loadRobotRewards({ db, userId, getOrder, now = new Date(), maxLookups = 60 }) {
  if (!db || !userId) throw new Error('Reward accounting is unavailable');
  const { data: grants, error: grantError } = await db.from('mss_voice_credit_grants')
    .select('order_id,product_id,created_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(2000);
  if (grantError) throw grantError;
  const ids = new Map();
  for (const grant of grants || []) {
    const id = String(grant.order_id || '').trim();
    if (id && !ids.has(id)) ids.set(id, grant.product_id);
  }
  if (!ids.size) return { ...summarizeRobotRewardOrders([]), pendingOrders: 0 };
  const { data: existing, error: cacheError } = await db.from('mss_robot_reward_orders')
    .select('order_id,user_id,product_id,paid_usd_cents,currency_code,status,purchased_at,checked_at')
    .eq('user_id', userId).limit(2000);
  if (cacheError) throw cacheError;
  const byId = new Map((existing || []).map(row => [row.order_id, row]));
  const pending = [];
  for (const [orderId, productId] of ids) {
    const cached = byId.get(orderId);
    const age = Date.parse(cached?.checked_at || '');
    if (!cached || cached.product_id !== productId || !Number.isFinite(age) || now.getTime() - age >= RECHECK_AFTER_MS) {
      pending.push({ orderId, productId });
    }
  }
  // New orders get priority over 24h refund re-checks.
  pending.sort((a,b) => Number(Boolean(byId.get(a.orderId))) - Number(Boolean(byId.get(b.orderId))));
  let failed = false;
  for (const { orderId, productId } of pending.slice(0, maxLookups)) {
    try {
      const order = await getOrder(orderId);
      if (order.orderId !== orderId) throw new Error('Mismatched order identity');
      const record = { ...normalizeGoogleRewardOrder(order, productId, now), user_id: userId };
      const { error } = await db.from('mss_robot_reward_orders').upsert(record, { onConflict: 'order_id' });
      if (error) throw error;
      byId.set(orderId, record);
    } catch (error) {
      failed = true;
      console.warn('MSS robot reward order synchronization pending', { orderId, reason: error?.message || 'unknown' });
    }
  }
  const complete = !failed && pending.length <= maxLookups;
  const summary = summarizeRobotRewardOrders([...byId.values()].filter(row => ids.has(row.order_id)));
  return { ...summary, status: complete ? 'ready' : 'pending', pendingOrders: Math.max(0, pending.length - maxLookups) + (failed ? 1 : 0) };
}
