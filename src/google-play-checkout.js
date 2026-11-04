import { isGooglePlayBillingSupported, MSSBilling, MSS_PLAY_TOPUP_PRODUCTS } from "./google-play-billing.js";

// Build-time opt-in. Production and OTA clients leave checkout hidden until
// the backend relay, minute accounting, and purchases are tested end-to-end.
export const isMssPlayCheckoutEnabled = () =>
  isGooglePlayBillingSupported() && import.meta.env.VITE_PLAY_BILLING_ENABLED === "true";

const labels = {
  mss_voice_60: "1 hour",
  mss_voice_120: "2 hours",
  mss_voice_300: "5 hours",
  mss_voice_600: "10 hours"
};

function node(tag, className = "", text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export async function playAccountHash(userId) {
  if (!/^[a-f0-9-]{36}$/i.test(String(userId || ""))) throw new Error("Sign in before purchasing voice minutes.");
  const bytes = new TextEncoder().encode("mss:" + userId.toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function createGooglePlayCheckout({ apiBase, getHeaders, getUserId }) {
  if (!isMssPlayCheckoutEnabled()) return { enabled: false, open() {} };

  const dialog = node("dialog", "mss-billing-dialog");
  dialog.setAttribute("aria-label", "Premium and voice minutes");
  const shell = node("div", "mss-billing-shell");
  const heading = node("div", "mss-billing-header");
  const title = node("h2", "", "Premium and voice minutes");
  const close = node("button", "mss-billing-close", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  heading.append(title, close);
  const balance = node("section", "mss-billing-balance", "Checking your voice minutes…");
  balance.setAttribute("aria-live", "polite");
  const status = node("p", "mss-billing-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const subscription = node("section", "mss-billing-subscription");
  const topups = node("section", "mss-billing-topups");
  const restore = node("button", "mss-billing-restore", "Restore purchases");
  restore.type = "button";
  const explanation = node("p", "mss-billing-footnote",
    "Premium renews monthly and includes 60 voice minutes per billing period. Extra purchased minutes stay in your account until used. The app uses monthly minutes first. You can manage your subscription in Google Play.");
  const actionBlock = node("div", "mss-billing-actions");
  actionBlock.append(restore);
  shell.append(heading, balance, subscription, topups, actionBlock, explanation, status);
  dialog.append(shell);
  document.body.append(dialog);

  let loading = false;
  let serverAvailable = false;
  let listener = null;
  let checkoutStartedAt = 0;
  let lastAutoRestoreAt = 0;
  let checkoutRecoveryTimers = [];

  function stopCheckoutRecovery() {
    for (const timer of checkoutRecoveryTimers) clearTimeout(timer);
    checkoutRecoveryTimers = [];
  }

  function startCheckoutRecovery() {
    stopCheckoutRecovery();
    // Play can return without delivering the native purchase event. Short,
    // bounded retries are essential for Google's 3-minute license-test window.
    for (const delayMs of [2000, 8000, 20000, 45000, 90000, 145000]) {
      checkoutRecoveryTimers.push(setTimeout(reconcileAfterReturningFromPlay, delayMs));
    }
  }

  function message(text) { status.textContent = text; }
  function setBusy(next) {
    loading = Boolean(next);
    for (const button of dialog.querySelectorAll("button")) {
      if (button !== close) button.disabled = loading || !serverAvailable;
    }
  }

  async function request(path, method = "GET", body) {
    const headers = await getHeaders();
    const response = await fetch(apiBase + path, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(18000)
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new Error(payload.error || "Billing service unavailable.");
    return payload;
  }

  async function refreshBalance() {
    const wallet = await request("/api/billing/status");
    const monthly = Math.max(0, Number(wallet.monthlyRemainingMs ?? wallet.monthlyMinutes * 60000) || 0);
    const extra = Math.max(0, Number(wallet.topupRemainingMs ?? wallet.topupMinutes * 60000) || 0);
    const totalMinutes = Math.floor((monthly + extra) / 60000);
    balance.replaceChildren(
      node("strong", "", totalMinutes + " minutes available"),
      node("span", "", Math.floor(monthly / 60000) + " monthly · " + Math.floor(extra / 60000) + " purchased minutes"),
      node("span", "", wallet.premiumActive ? "Premium active" : "No active Premium subscription")
    );
    return wallet;
  }

  async function verifyPurchase(purchase) {
    if (!purchase || purchase.purchaseState !== 1 || !Array.isArray(purchase.products)) return false;
    const productId = purchase.products.find(id => id === "mss_premium" || Object.hasOwn(labels, id));
    if (!productId || !purchase.purchaseToken) return false;
    const result = await request("/api/billing/verify", "POST", {
      productId, purchaseToken: purchase.purchaseToken
    });
    if (result.finalizationPending) {
      await refreshBalance();
      // The wallet is credited, but Google Play still requires consumption
      // or acknowledgement. Keep the purchase in the retry loop so a test
      // purchase is not automatically refunded after three minutes.
      throw new Error("Minutes credited, but Google Play confirmation is pending. Retrying.");
    }
    if (result.newlyCredited) message(productId === "mss_premium"
      ? "Premium is active. Your monthly voice minutes have been added."
      : result.minutes + " voice minutes added successfully.");
    await refreshBalance();
    return true;
  }

  async function restorePurchases() {
    if (loading) return;
    setBusy(true);
    message("Checking Google Play for purchases…");
    try {
      const queries = await Promise.allSettled([
        MSSBilling.getExistingPurchases(), MSSBilling.getExistingVoiceTopUpPurchases()
      ]);
      const purchases = queries.flatMap(result => result.status === "fulfilled" ? result.value.purchases || [] : []);
      if (queries.every(result => result.status === "rejected")) throw new Error("Google Play purchase history is unavailable.");
      let restored = 0;
      const errors = queries
        .filter(result => result.status === "rejected")
        .map(result => result.reason?.message || "A Google Play purchase query failed.");
      const seen = new Set();
      for (const purchase of purchases) {
        const token = purchase.purchaseToken;
        if (!token || seen.has(token)) continue;
        seen.add(token);
        try {
          if (await verifyPurchase(purchase)) restored++;
        } catch (error) {
          // Continue checking other purchases and surface the actual error.
          // Never treat a failed server verification as a successful restore.
          errors.push(error?.message || "Purchase verification failed.");
        }
      }
      await refreshBalance();
      message(errors.length
        ? "Some purchases could not be verified: " + errors[0]
        : restored
          ? "Purchases verified. Your current balance is shown above."
          : "No active purchases to restore. Refunded test orders cannot be restored.");
      return restored;
    } catch (error) {
      message(error?.message || "Purchases could not be restored.");
      return 0;
    } finally { setBusy(false); }
  }
  restore.addEventListener("click", restorePurchases);

  function buttonFor(label, price, onclick) {
    const btn = node("button", "mss-billing-buy");
    btn.type = "button";
    btn.append(node("span", "", label), node("strong", "", price));
    btn.addEventListener("click", async () => {
      if (loading || !serverAvailable) return;
      setBusy(true);
      message("Opening Google Play's secure checkout…");
      try {
        // The native purchase callback can be missed while Android switches
        // to the Play checkout. Reconcile unconsumed purchases on return.
        checkoutStartedAt = Date.now();
        startCheckoutRecovery();
        await onclick();
        message("Complete your purchase in Google Play. Minutes will appear after confirmation.");
      } catch (error) {
        checkoutStartedAt = 0;
        stopCheckoutRecovery();
        message(error?.message || "Google Play checkout could not start.");
      }
      finally { setBusy(false); }
    });
    return btn;
  }

  async function checkoutAccountId() {
    if (!getUserId()) throw new Error("Sign in to MySecondSelf first.");
    // A fresh Supabase session is required; the account hash alone is not authorization.
    await getHeaders();
    return playAccountHash(getUserId());
  }

  async function open() {
    if (!dialog.open) dialog.showModal();
    serverAvailable = false;
    setBusy(true);
    message("Connecting to Google Play…");
    try {
      const healthResponse = await fetch(apiBase + "/health", { signal: AbortSignal.timeout(10000) });
      const health = await healthResponse.json();
      if (!healthResponse.ok || health.paidVoiceEnabled !== true) {
        throw new Error("Purchases are being prepared. No charges can be made yet.");
      }
      const wallet = await refreshBalance();
      if (!wallet.billingEnabledForUser) {
        throw new Error("Purchases are currently available only for designated test accounts.");
      }
      const [subscriptionOffers, topUpOffers] = await Promise.all([
        MSSBilling.getSubscriptionOffers(), MSSBilling.getVoiceTopUpOffers()
      ]);
      const plan = (subscriptionOffers.offers || []).find(item =>
        item.productId === "mss_premium" && item.basePlanId === "monthly" && !item.offerId);
      const phase = plan?.pricingPhases?.at(-1);
      subscription.replaceChildren(node("h3", "", "Premium monthly"));
      if (phase?.formattedPrice) {
        subscription.append(buttonFor("60 voice minutes every month", phase.formattedPrice + " / month", async () => {
          await MSSBilling.startSubscriptionPurchase({
            basePlanId: "monthly", obfuscatedAccountId: await checkoutAccountId()
          });
        }));
      } else {
        subscription.append(node("p", "", "Monthly Premium is not offered for this Google Play account."));
      }
      topups.replaceChildren(node("h3", "", "Add voice minutes"));
      for (const item of MSS_PLAY_TOPUP_PRODUCTS) {
        const offer = (topUpOffers.offers || []).find(p => p.productId === item.productId && p.purchaseOptionId === "buy");
        if (!offer?.formattedPrice) continue;
        topups.append(buttonFor(labels[item.productId], offer.formattedPrice, async () => {
          await MSSBilling.startVoiceTopUpPurchase({
            productId: item.productId, obfuscatedAccountId: await checkoutAccountId()
          });
        }));
      }
      serverAvailable = true;
      message("Prices shown are your Google Play regional prices.");
    } catch (error) {
      serverAvailable = false;
      message(error?.message || "Google Play purchases are currently unavailable.");
      subscription.replaceChildren();
      topups.replaceChildren();
    } finally { setBusy(false); }
  }

  function reconcileAfterReturningFromPlay() {
    if (!checkoutStartedAt || !getUserId() || loading) return;
    const now = Date.now();
    // Avoid polling on unrelated focus events and duplicate lifecycle events.
    if (now - checkoutStartedAt > 3 * 60 * 1000) {
      checkoutStartedAt = 0;
      stopCheckoutRecovery();
      return;
    }
    if (now - lastAutoRestoreAt < 3000) return;
    lastAutoRestoreAt = now;
    void restorePurchases().then((restored) => {
      if (restored > 0) {
        checkoutStartedAt = 0;
        stopCheckoutRecovery();
      }
    });
  }

  window.addEventListener("focus", reconcileAfterReturningFromPlay);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconcileAfterReturningFromPlay();
  });

  void MSSBilling.addListener("purchaseUpdated", async (event) => {
    if (!event || event.responseCode !== 0) {
      if (event?.responseCode === 1) {
        checkoutStartedAt = 0;
        stopCheckoutRecovery();
      } else if (dialog.open) {
        message("Google Play did not complete the purchase.");
      }
      return;
    }
    for (const purchase of event.purchases || []) {
      try {
        if (await verifyPurchase(purchase)) {
          checkoutStartedAt = 0;
          stopCheckoutRecovery();
        }
      } catch (error) {
        // Preserve the failed purchase for the next foreground reconciliation.
        if (dialog.open) message(error?.message || "Payment verification is pending.");
      }
    }
  }).then(value => { listener = value; }).catch(() => {});

  async function syncOnSignIn() {
    if (!getUserId()) return false;
    try {
      const response = await fetch(apiBase + "/health", { signal: AbortSignal.timeout(10000) });
      const health = await response.json();
      if (!response.ok || health.paidVoiceEnabled !== true) return false;
      const wallet = await request("/api/billing/status");
      if (!wallet.billingEnabledForUser) return false;
      await restorePurchases();
      return true;
    } catch {
      // Retry automatically on next sign-in or manually through Restore.
      return false;
    }
  }

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return { enabled: true, open, refreshBalance, restorePurchases, syncOnSignIn,
    close() { dialog.close(); stopCheckoutRecovery(); void listener?.remove?.(); } };
}
