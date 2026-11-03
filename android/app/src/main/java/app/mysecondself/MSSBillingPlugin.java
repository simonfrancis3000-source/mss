package app.mysecondself;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Android Billing transport only. This plugin NEVER grants MSS entitlements.
 * Purchase tokens must be verified server-side before granting access.
 * No checkout UI invokes this plugin until backend verification is implemented.
 */
@CapacitorPlugin(name = "MSSBilling")
public class MSSBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final String SUBSCRIPTION_ID = "mss_premium";
    private BillingClient client;
    private boolean connecting;
    private final List<PendingAction> pendingActions = new ArrayList<>();

    private static class PendingAction {
        final PluginCall call;
        final Runnable action;
        PendingAction(PluginCall call, Runnable action) {
            this.call = call;
            this.action = action;
        }
    }

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder()
                        .enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
    }

    private void withBilling(PluginCall call, Runnable action) {
        getActivity().runOnUiThread(() -> {
            if (client == null) {
                call.reject("Google Play Billing has not been initialized");
                return;
            }
            if (client.isReady()) {
                action.run();
                return;
            }
            pendingActions.add(new PendingAction(call, action));
            if (connecting) return;
            connecting = true;
            client.startConnection(new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(BillingResult result) {
                    connecting = false;
                    List<PendingAction> queued = new ArrayList<>(pendingActions);
                    pendingActions.clear();
                    for (PendingAction item : queued) {
                        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            item.action.run();
                        } else {
                            item.call.reject("Google Play Billing unavailable: " + result.getDebugMessage());
                        }
                    }
                }

                @Override
                public void onBillingServiceDisconnected() {
                    // Billing Library v9 handles automatic service reconnection.
                }
            });
        });
    }

    private QueryProductDetailsParams subscriptionQuery() {
        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(SUBSCRIPTION_ID)
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
        return QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();
    }

    @PluginMethod
    public void getSubscriptionOffers(PluginCall call) {
        withBilling(call, () -> client.queryProductDetailsAsync(subscriptionQuery(), (result, products) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Cannot load subscription offers: " + result.getDebugMessage());
                return;
            }
            JSArray offers = new JSArray();
            for (ProductDetails product : products.getProductDetailsList()) {
                List<ProductDetails.SubscriptionOfferDetails> list = product.getSubscriptionOfferDetails();
                if (list == null) continue;
                for (ProductDetails.SubscriptionOfferDetails offer : list) {
                    JSObject data = new JSObject();
                    data.put("productId", product.getProductId());
                    data.put("basePlanId", offer.getBasePlanId());
                    data.put("offerId", offer.getOfferId());
                    data.put("offerToken", offer.getOfferToken());
                    JSArray phases = new JSArray();
                    for (ProductDetails.PricingPhase phase : offer.getPricingPhases().getPricingPhaseList()) {
                        JSObject price = new JSObject();
                        price.put("formattedPrice", phase.getFormattedPrice());
                        price.put("currencyCode", phase.getPriceCurrencyCode());
                        price.put("billingPeriod", phase.getBillingPeriod());
                        price.put("priceAmountMicros", phase.getPriceAmountMicros());
                        phases.put(price);
                    }
                    data.put("pricingPhases", phases);
                    offers.put(data);
                }
            }
            JSObject response = new JSObject();
            response.put("offers", offers);
            call.resolve(response);
        }));
    }

    @PluginMethod
    public void getExistingPurchases(PluginCall call) {
        withBilling(call, () -> client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS).build(), (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Cannot query subscriptions: " + result.getDebugMessage());
                return;
            }
            JSObject response = new JSObject();
            response.put("purchases", toPurchaseList(purchases));
            call.resolve(response);
        }));
    }

    /**
     * Opens Google Play's checkout. Does not activate Premium access.
     * Do not invoke before backend purchase-token verification is available.
     */
    @PluginMethod
    public void startSubscriptionPurchase(PluginCall call) {
        String accountId = call.getString("obfuscatedAccountId");
        if (accountId == null || !accountId.matches("[a-f0-9]{64}")) {
            call.reject("Verified MSS account identifier is required");
            return;
        }
        String basePlanId = call.getString("basePlanId");
        if (basePlanId == null || basePlanId.trim().isEmpty()) {
            call.reject("basePlanId is required");
            return;
        }
        withBilling(call, () -> client.queryProductDetailsAsync(subscriptionQuery(), (result, products) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Cannot load subscription: " + result.getDebugMessage());
                return;
            }
            for (ProductDetails product : products.getProductDetailsList()) {
                List<ProductDetails.SubscriptionOfferDetails> offers = product.getSubscriptionOfferDetails();
                if (offers == null) continue;
                for (ProductDetails.SubscriptionOfferDetails offer : offers) {
                    // Select only the standard base plan, not a promotional offer.
                    if (!basePlanId.equals(offer.getBasePlanId()) || offer.getOfferId() != null) continue;
                    BillingFlowParams.ProductDetailsParams item = BillingFlowParams.ProductDetailsParams
                            .newBuilder().setProductDetails(product)
                            .setOfferToken(offer.getOfferToken()).build();
                    BillingFlowParams params = BillingFlowParams.newBuilder()
                            .setProductDetailsParamsList(Collections.singletonList(item))
                            .setObfuscatedAccountId(accountId).build();
                    getActivity().runOnUiThread(() -> {
                        BillingResult started = client.launchBillingFlow(getActivity(), params);
                        if (started.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                            call.reject("Could not start checkout: " + started.getDebugMessage());
                        } else {
                            JSObject response = new JSObject();
                            response.put("started", true);
                            call.resolve(response);
                        }
                    });
                    return;
                }
            }
            call.reject("No eligible standard base plan found: " + basePlanId);
        }));
    }

    private static final String[] VOICE_TOPUP_IDS = {
        "mss_voice_60", "mss_voice_120", "mss_voice_300", "mss_voice_600"
    };

    private boolean isAllowedTopUp(String id) {
        if (id == null) return false;
        for (String allowed : VOICE_TOPUP_IDS) {
            if (allowed.equals(id)) return true;
        }
        return false;
    }

    private QueryProductDetailsParams topUpQuery(String id) {
        QueryProductDetailsParams.Product product =
                QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build();
        return QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();
    }

    /**
     * Returns country-appropriate prices from Google Play. Never hard-code
     * USD amounts or trust a client-supplied price for entitlement purposes.
     */
    @PluginMethod
    public void getVoiceTopUpOffers(PluginCall call) {
        withBilling(call, () -> {
            List<QueryProductDetailsParams.Product> products = new ArrayList<>();
            for (String id : VOICE_TOPUP_IDS) {
                products.add(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build());
            }
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                    .setProductList(products).build();
            client.queryProductDetailsAsync(params, (result, details) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject("Cannot load voice credit products: " + result.getDebugMessage());
                    return;
                }
                JSArray offers = new JSArray();
                for (ProductDetails product : details.getProductDetailsList()) {
                    List<ProductDetails.OneTimePurchaseOfferDetails> list =
                            product.getOneTimePurchaseOfferDetailsList();
                    if (list == null) continue;
                    for (ProductDetails.OneTimePurchaseOfferDetails offer : list) {
                        if (!"buy".equals(offer.getPurchaseOptionId())) continue;
                        JSObject item = new JSObject();
                        item.put("productId", product.getProductId());
                        item.put("purchaseOptionId", offer.getPurchaseOptionId());
                        item.put("formattedPrice", offer.getFormattedPrice());
                        item.put("offerToken", offer.getOfferToken());
                        offers.put(item);
                    }
                }
                JSObject response = new JSObject();
                response.put("offers", offers);
                call.resolve(response);
            });
        });
    }

    /**
     * Launches a consumable purchase only. Granting minutes is exclusively
     * a server-side operation after Google Play purchase-token verification.
     */
    @PluginMethod
    public void startVoiceTopUpPurchase(PluginCall call) {
        String accountId = call.getString("obfuscatedAccountId");
        if (accountId == null || !accountId.matches("[a-f0-9]{64}")) {
            call.reject("Verified MSS account identifier is required");
            return;
        }
        String productId = call.getString("productId");
        if (!isAllowedTopUp(productId)) {
            call.reject("Unknown voice credit package");
            return;
        }
        withBilling(call, () -> client.queryProductDetailsAsync(topUpQuery(productId), (result, details) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Cannot load voice credit package: " + result.getDebugMessage());
                return;
            }
            for (ProductDetails product : details.getProductDetailsList()) {
                List<ProductDetails.OneTimePurchaseOfferDetails> offers =
                        product.getOneTimePurchaseOfferDetailsList();
                if (offers == null) continue;
                for (ProductDetails.OneTimePurchaseOfferDetails offer : offers) {
                    if (!"buy".equals(offer.getPurchaseOptionId())) continue;
                    BillingFlowParams.ProductDetailsParams item =
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                    .setProductDetails(product)
                                    .setOfferToken(offer.getOfferToken())
                                    .build();
                    BillingFlowParams params = BillingFlowParams.newBuilder()
                            .setProductDetailsParamsList(Collections.singletonList(item))
                            .setObfuscatedAccountId(accountId).build();
                    getActivity().runOnUiThread(() -> {
                        BillingResult started = client.launchBillingFlow(getActivity(), params);
                        if (started.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            JSObject response = new JSObject();
                            response.put("started", true);
                            call.resolve(response);
                        } else {
                            call.reject("Could not start voice credit checkout: " + started.getDebugMessage());
                        }
                    });
                    return;
                }
            }
            call.reject("No eligible buy purchase option found for " + productId);
        }));
    }

    /**
     * Supplies purchased but not yet consumed INAPP tokens for backend replay
     * and recovery. Do not locally consume without a verified server grant.
     */
    @PluginMethod
    public void getExistingVoiceTopUpPurchases(PluginCall call) {
        withBilling(call, () -> client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP).build(), (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Cannot query outstanding voice credit purchases: " + result.getDebugMessage());
                return;
            }
            JSObject response = new JSObject();
            response.put("purchases", toPurchaseList(purchases));
            call.resolve(response);
        }));
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        JSObject payload = new JSObject();
        payload.put("responseCode", result.getResponseCode());
        payload.put("message", result.getDebugMessage());
        payload.put("purchases", toPurchaseList(purchases));
        notifyListeners("purchaseUpdated", payload);
        // No entitlements or purchase acknowledgments until secure backend verification.
    }

    private JSArray toPurchaseList(List<Purchase> purchases) {
        JSArray output = new JSArray();
        if (purchases == null) return output;
        for (Purchase purchase : purchases) {
            JSObject item = new JSObject();
            JSArray productIds = new JSArray();
            for (String productId : purchase.getProducts()) productIds.put(productId);
            item.put("products", productIds);
            item.put("purchaseToken", purchase.getPurchaseToken());
            item.put("purchaseState", purchase.getPurchaseState());
            item.put("acknowledged", purchase.isAcknowledged());
            output.put(item);
        }
        return output;
    }
}
