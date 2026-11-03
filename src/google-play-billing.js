import { Capacitor, registerPlugin } from "@capacitor/core";

// Native bridge for Google Play Billing. This is not active in the UI yet.
// Purchases must be verified on the MSS backend before enabling Premium access.
export const MSS_PLAY_SUBSCRIPTION_ID = "mss_premium";
export const isGooglePlayBillingSupported = () => Capacitor.getPlatform() === "android";
export const MSSBilling = registerPlugin("MSSBilling");

// API:
// MSSBilling.getSubscriptionOffers() -> { offers: [...] }
// MSSBilling.getExistingPurchases() -> { purchases: [...] }
// MSSBilling.startSubscriptionPurchase({ basePlanId: "monthly" | "yearly" })
// MSSBilling.addListener("purchaseUpdated", callback)
// Do not call startSubscriptionPurchase until purchase verification and
// acknowledgment are implemented in the MSS backend.
