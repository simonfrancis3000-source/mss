import test from "node:test";
import assert from "node:assert/strict";
import { MSS_TOPUP_MINUTES, MSS_PLAY_PACKAGE, parseVerifiedPlayPurchase, hashPurchaseToken, obfuscatedPlayAccountId } from "../server/google-play-billing.js";

test("Google Play package and product catalogue match the activated Play listing", () => {
  assert.equal(MSS_PLAY_PACKAGE, "app.mysecondself");
  assert.deepEqual(MSS_TOPUP_MINUTES, {
    mss_voice_60: 60, mss_voice_120: 120,
    mss_voice_300: 300, mss_voice_600: 600
  });
});

test("valid completed purchase is mapped to verified minutes", () => {
  const receipt = {
    purchaseStateContext: { purchaseState: "PURCHASED" },
    orderId: "GPA-test",
    productLineItem: [{
      productId: "mss_voice_120",
      productOfferDetails: { purchaseOptionId: "buy", quantity: 1, refundableQuantity: 1 }
    }]
  };
  assert.deepEqual(parseVerifiedPlayPurchase(receipt, { productId: "mss_voice_120" }), {
    kind: "topup", productId: "mss_voice_120",
    minutes: 120, periodEnd: null, orderId: "GPA-test", needsConsumption: true
  });
});

test("pending, mismatched and refunded purchases never grant credits", () => {
  const receipt = {
    purchaseStateContext: { purchaseState: "PENDING" },
    productLineItem: [{
      productId: "mss_voice_60",
      productOfferDetails: { purchaseOptionId: "buy", quantity: 1, refundableQuantity: 1 }
    }]
  };
  assert.throws(() => parseVerifiedPlayPurchase(receipt, { productId: "mss_voice_60" }), /not completed/);
  receipt.purchaseStateContext.purchaseState = "PURCHASED";
  assert.throws(() => parseVerifiedPlayPurchase(receipt, { productId: "mss_voice_300" }), /does not match/);
  receipt.productLineItem[0].productOfferDetails.refundableQuantity = 0;
  assert.throws(() => parseVerifiedPlayPurchase(receipt, { productId: "mss_voice_60" }), /refunded/);
});

test("only active or grace-period Premium subscriptions grant monthly minutes", () => {
  const receipt = {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    lineItems: [{ productId: "mss_premium", expiryTime: "2026-12-03T00:00:00Z" }]
  };
  const v = parseVerifiedPlayPurchase(receipt, { productId: "mss_premium", now: new Date("2026-11-03T00:00:00Z") });
  assert.equal(v.minutes, 60);
  assert.equal(v.requiresAcknowledgement, true);
  receipt.lineItems[0].expiryTime = "2026-10-01T00:00:00Z";
  assert.throws(() => parseVerifiedPlayPurchase(receipt, { productId: "mss_premium", now: new Date("2026-11-03T00:00:00Z") }), /not active/);
});

test("purchase tokens are hashed and not stored as plaintext", () => {
  const token = "example-google-play-purchase-token-unique";
  assert.match(hashPurchaseToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashPurchaseToken(token), token);
  assert.throws(() => hashPurchaseToken("short"), /Invalid/);
});

test("Google Play account ID is a stable one-way hash of the signed-in Supabase user", () => {
  const user = "11111111-2222-3333-4444-555555555555";
  const accountId = obfuscatedPlayAccountId(user);
  assert.match(accountId, /^[a-f0-9]{64}$/);
  assert.equal(accountId, obfuscatedPlayAccountId(user.toUpperCase()));
  assert.notEqual(accountId, obfuscatedPlayAccountId("11111111-2222-3333-4444-555555555556"));
  assert.throws(() => obfuscatedPlayAccountId("not-a-user-id"), /Invalid signed-in account/);
});
