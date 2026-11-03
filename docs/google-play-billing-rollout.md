# MySecondSelf Google Play billing: staged integration, not launch-ready

## Store catalogue confirmed by owner (3 November 2026)

| Play product | Type | USD reference | Voice minutes |
|---|---|---:|---:|
| `mss_premium` / `monthly` | Auto-renewing subscription | 9.99/month | 60 per paid billing period |
| `mss_voice_60` / `buy` | Consumable one-time purchase | 9.99 | 60 |
| `mss_voice_120` / `buy` | Consumable one-time purchase | 18.99 | 120 |
| `mss_voice_300` / `buy` | Consumable one-time purchase | 44.99 | 300 |
| `mss_voice_600` / `buy` | Consumable one-time purchase | 84.99 | 600 |

Play account, taxes, country prices and future price changes are managed in Google Play. App purchase UI should display the localized `formattedPrice` returned by BillingClient, not hard-code USD.

## What has been prepared on this feature branch

- Android native bridge supports Play one-time product discovery, four specific packages and the standard `buy` purchase option, purchase initiation and retrieval of outstanding unconsumed products.
- Server validates purchase tokens with the Google Android Publisher API, checks purchase state and actual package/product, and maps **only** verified products to minutes.
- `POST /api/billing/verify` requires a signed-in Supabase bearer token and grants credits using a server-only RLS-protected database function. Duplicate token redemption is idempotent; all token owners are bound to a user.
- `GET /api/billing/status` returns monthly and prepaid minute balances for the authenticated account.
- Google acknowledges subscriptions and consumes top-ups **after** the database grant succeeds. Both operations need provider retry handling.
- Schema migration is staged in `supabase/migrations/20261103190000_mss_play_voice_credit_wallets.sql`. It has **not** been applied automatically.
- Unit tests cover purchase-state checks, product ID matching, refund quantity and subscription expiration.

## Required owner action in Google Cloud / Google Play

1. Open Google Cloud Console in the desired project. Under **APIs & Services → Library**, enable **Google Play Developer API**.
2. Under **IAM & Admin → Service Accounts**, create a dedicated server-to-server account (e.g. `mss-play-billing`).
3. In **Google Play Console → Users and permissions**, invite the service account email as a user, limit it to the MySecondSelf app, and grant **View financial data, orders and cancellation survey responses** and **Manage orders and subscriptions**, as required by the Google Play Developer API.
4. Create a JSON credential key in the service account credentials page only if needed for the current hosting approach. Store the entire JSON securely in the **Render backend** secret environment variable `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Do not place it in this repository, chat messages, the Capacitor app, or any `VITE_` variable.
5. In the backend service configure `SUPABASE_URL` and a server-only `SUPABASE_SERVICE_ROLE_KEY` (or existing `SUPABASE_SECRET_KEY`) so the RLS-protected grant RPC can execute. Keep these exclusively server side.
6. After review, apply the staged schema migration to the correct MySecondSelf Supabase project `ltqbjqtzsdzglswuqkip`. Verify policies and RPC permissions before enabling purchase buttons.

Google's current setup: https://developers.google.com/android-publisher/getting_started

## Still required before charging customers

**Do not merge or expose checkout solely because the product IDs are Active.**

- Implement the signed-in client purchase screen, event handling, verification POST and a restore/retry queue for pending transactions.
- Meter and **enforce** voice minutes in real time. Current `/api/phonic/usage` is client-reported at the end of a voice call and can neither reliably settle simultaneous calls nor prevent an already-issued Phonic WebSocket token from being used beyond the allowance. A server-controlled voice-session lease/cap, recurring consumption and enforceable cutoff or relay are required. Server must deny opening further sessions when credits are exhausted.
- Decide exactly how a cancelled/expired subscription affects eligibility for **unused separately purchased top-up minutes**. Do not strand purchased consumables.
- Ensure monthly minutes are used first and reset on verified renewals; top-ups persist. Explicitly define and test refunds/chargebacks, order reversals and Real-Time Developer Notifications (RTDN) or scheduled Play reconciliation.
- Cover store account changes, offline resumes, restore, reinstall, pending payments, duplicate callbacks, multiple devices, server timeouts, Play billing response codes, acknowledgement/consumption retries and Google license-test orders.
- Update premium status and balance in app, error messages and paywall disclosure; test Google Play closed track on a tester device.
- Complete App Store / StoreKit separately before selling these products on iOS.
- Build and validate the Android release with Gradle and run `npm test` in a connected environment.

## Launch condition

Only activate **client checkout** when test purchases create **one and only one** credit grant, the user can see their wallet, sessions stop at the approved cap, and refunds/revocations update entitlement. The Google Play store listing status alone is not evidence of backend readiness.
