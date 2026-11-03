import { Capacitor, registerPlugin } from "@capacitor/core";

// Native bridge for Google Play Billing. This is not active in the UI yet.
// Purchases must be verified on the MSS backend before enabling Premium access.
export const MSS_PLAY_SUBSCRIPTION_ID = "mss_premium";
export const MSS_PLAY_TOPUP_PRODUCTS = Object.freeze([
  { productId: "mss_voice_60", minutes: 60 },
  { productId: "mss_voice_120", minutes: 120 },
  { productId: "mss_voice_300", minutes: 300 },
  { productId: "mss_voice_600", minutes: 600 }
]);
export const isGooglePlayBillingSupported = () => Capacitor.getPlatform() === "android";
export const MSSBilling = registerPlugin("MSSBilling");

// API:
// MSSBilling.getSubscriptionOffers() -> { offers: [...] }
// MSSBilling.getExistingPurchases() -> { purchases: [...] }
// MSSBilling.startSubscriptionPurchase({ basePlanId: "monthly" | "yearly" })
// MSSBilling.addListener("purchaseUpdated", callback)
// MSSBilling.getVoiceTopUpOffers() -> { offers: [{productId,purchaseOptionId,formattedPrice,offerToken}] }
// MSSBilling.getExistingVoiceTopUpPurchases() -> { purchases: [...] }
// MSSBilling.startVoiceTopUpPurchase({ productId: "mss_voice_60" | ... })
// After "purchaseUpdated" or on launch, POST the purchaseToken + productId to
// /api/billing/verify with the signed-in Supabase bearer token.
// Never grant voice minutes locally. The server verifies the purchase with
// Google Play and atomically credits the corresponding user's wallet.
// Never enable checkout until the server verification, accounting and hard
// voice-session cutoff are fully configured and tested.
