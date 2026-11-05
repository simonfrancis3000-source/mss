import { createHash, sign } from "node:crypto";

export const MSS_PLAY_PACKAGE = "app.mysecondself";
export const MSS_PREMIUM_PRODUCT = "mss_premium";
export const MSS_TOPUP_MINUTES = Object.freeze({
  mss_voice_60: 60,
  mss_voice_120: 120,
  mss_voice_300: 300,
  mss_voice_600: 600
});

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function obfuscatedPlayAccountId(userId) {
  if (typeof userId !== "string" || !/^[a-f0-9-]{36}$/i.test(userId)) {
    throw fail("Invalid signed-in account.", 401);
  }
  return createHash("sha256").update("mss:" + userId.toLowerCase()).digest("hex");
}

export function hashPurchaseToken(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 8192) {
    throw fail("Invalid Google Play purchase token.");
  }
  return createHash("sha256").update(token).digest("hex");
}

export function parseVerifiedPlayPurchase(payload, { productId, now = new Date() } = {}) {
  const timestamp = now.getTime();
  if (productId === MSS_PREMIUM_PRODUCT) {
    if (!["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"].includes(payload?.subscriptionState)) {
      throw fail("Google Play reports that Premium is not active.", 403);
    }
    const active = (payload?.lineItems || []).filter(item => item?.productId === MSS_PREMIUM_PRODUCT &&
      Date.parse(item?.expiryTime || "") > timestamp);
    if (!active.length) throw fail("The Premium billing period is not active.", 403);
    const periodEnd = active.map(item => item.expiryTime).sort().at(-1);
    return { productId, kind: "subscription", minutes: 60, periodEnd, orderId: active[0].latestSuccessfulOrderId || "", requiresAcknowledgement: payload.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" };
  }

  if (!Object.hasOwn(MSS_TOPUP_MINUTES, productId)) throw fail("Unknown voice credit product.");
  if (payload?.purchaseStateContext?.purchaseState !== "PURCHASED") {
    throw fail("Google Play has not completed this purchase.", 403);
  }
  const lines = payload?.productLineItem || [];
  if (lines.length !== 1 || lines[0]?.productId !== productId ||
      lines[0]?.productOfferDetails?.purchaseOptionId !== "buy") {
    throw fail("The Google Play receipt does not match the selected voice credit package.", 403);
  }
  const quantity = Number(lines[0]?.productOfferDetails?.quantity || 1);
  const refundableQuantity = Number(lines[0]?.productOfferDetails?.refundableQuantity ?? quantity);
  if (!Number.isInteger(quantity) || quantity !== 1 || refundableQuantity !== 1) {
    throw fail("Invalid or refunded credit purchase quantity.", 403);
  }
  return { productId, kind: "topup", minutes: MSS_TOPUP_MINUTES[productId], periodEnd: null, orderId: payload.orderId || "", needsConsumption: lines[0]?.productOfferDetails?.consumptionState !== "CONSUMPTION_STATE_CONSUMED" };
}

let cachedToken = null;
let cachedExpiry = 0;

async function googleAccessToken() {
  if (cachedToken && Date.now() < cachedExpiry) return cachedToken;
  let account;
  try { account = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || ""); }
  catch { throw fail("Google Play service account is not configured.", 503); }
  if (account?.type !== "service_account" || !account.client_email || !account.private_key) {
    throw fail("Google Play service account is not configured.", 503);
  }
  const issued = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: issued,
    exp: issued + 3500
  }));
  const message = header + "." + claims;
  const signature = sign("RSA-SHA256", Buffer.from(message), account.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: message + "." + signature }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const error = fail("Google Play authentication failed.", 502);
    error.code = "google_oauth_http_" + response.status;
    throw error;
  }
  const json = await response.json();
  if (!json.access_token) {
    const error = fail("Google Play authentication failed.", 502);
    error.code = "google_oauth_missing_token";
    throw error;
  }
  cachedToken = json.access_token;
  cachedExpiry = Date.now() + Math.max(30, Math.min(Number(json.expires_in || 3600), 3600) - 120) * 1000;
  return cachedToken;
}

export async function verifyGooglePlayToken({ productId, purchaseToken, userId } = {}) {
  const expectedAccountId = obfuscatedPlayAccountId(userId);
  hashPurchaseToken(purchaseToken);
  if (productId !== MSS_PREMIUM_PRODUCT && !Object.hasOwn(MSS_TOPUP_MINUTES, productId)) {
    throw fail("Unknown Google Play product.");
  }
  const token = await googleAccessToken();
  const endpoint = productId === MSS_PREMIUM_PRODUCT
    ? `/androidpublisher/v3/applications/${MSS_PLAY_PACKAGE}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`
    : `/androidpublisher/v3/applications/${MSS_PLAY_PACKAGE}/purchases/productsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch("https://androidpublisher.googleapis.com" + endpoint, {
    headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = fail(response.status === 404 ? "Purchase not found in Google Play." : "Google Play purchase verification failed.", response.status === 404 ? 403 : 502);
    error.code = "google_publisher_http_" + response.status;
    throw error;
  }
  const details = await response.json();
  const accountId = productId === MSS_PREMIUM_PRODUCT
    ? details?.externalAccountIdentifiers?.obfuscatedExternalAccountId
    : details?.obfuscatedExternalAccountId;
  if (accountId !== expectedAccountId) {
    throw fail("This Google Play purchase is not linked to the signed-in MySecondSelf account.", 403);
  }
  return { ...parseVerifiedPlayPurchase(details, { productId }), isTest: Boolean(details?.testPurchase || details?.testPurchaseContext) };
}

/** Consume only AFTER the corresponding minute grant has been durably committed. */
export async function consumeVerifiedGoogleTopUp({ productId, purchaseToken } = {}) {
  if (!Object.hasOwn(MSS_TOPUP_MINUTES, productId)) throw fail("Unknown voice credit package.");
  const token = await googleAccessToken();
  const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${MSS_PLAY_PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`;
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw fail("Purchase was credited, but Google Play consumption needs retry.", 502);
  return true;
}

export async function acknowledgeVerifiedGoogleSubscription(purchaseToken) {
  const token = await googleAccessToken();
  // Subscription acknowledgement is idempotent from the caller's perspective:
  // Google Play may report an already-acknowledged receipt.
  const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${MSS_PLAY_PACKAGE}/purchases/subscriptions/${MSS_PREMIUM_PRODUCT}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000) });
  if (!response.ok && response.status !== 400) throw fail("Premium is active, but Google Play acknowledgement needs retry.", 502);
  return true;
}


/** Look up billed amounts and refund states from Google Play. Order IDs originate from verified grants. */
export async function getGooglePlayOrder(orderId) {
  if (typeof orderId !== 'string' || !/^[a-z\d.\-_:]{4,150}$/i.test(orderId)) {
    throw fail('Invalid Google Play order ID.', 400);
  }
  const token=await googleAccessToken();
  const endpoint='/androidpublisher/v3/applications/'+MSS_PLAY_PACKAGE+'/orders/'+encodeURIComponent(orderId);
  const response=await fetch('https://androidpublisher.googleapis.com'+endpoint, {
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) throw fail('Could not verify the Google Play order.', response.status===404?404:502);
  return response.json();
}
