# MySecondSelf Google Play billing: controlled release checklist

Updated 3 November 2026. Paid checkout is not yet enabled for general customers.

## Confirmed Play products

| Product ID | Offer ID | Charge (US base price) | Entitlement |
|---|---|---:|---|
| `mss_premium` | `monthly` | $9.99 recurring | 60 voice minutes per current billing period |
| `mss_voice_60` | `buy` | $9.99 one-time | 60 non-expiring top-up minutes |
| `mss_voice_120` | `buy` | $18.99 one-time | 120 non-expiring top-up minutes |
| `mss_voice_300` | `buy` | $44.99 one-time | 300 non-expiring top-up minutes |
| `mss_voice_600` | `buy` | $84.99 one-time | 600 non-expiring top-up minutes |

Android gets localized prices from BillingClient. Purchased credits use monthly minutes first when those are valid, then top-ups.

## Completed

- Google Play Android Developer API enabled, service account invited with app-scoped financial and order permissions.
- Android license tester list `MSS Testers` selected and saved.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` and `SUPABASE_SECRET_KEY` stored in Render backend environment.
- New Supabase wallet tables, token ownership, grants and prepaid voice-session lease schema applied to project `ltqbjqtzsdzglswuqkip`; migrations:
  - `20261103191338_mss_play_voice_credit_wallets`
  - `20261103191520_mss_voice_lease_minimum_one_second`
- Live tables had zero rows after installation; RLS enabled and security checks performed.
- Server Google Play verification checks purchase state, product option, product ID, quantity, refund eligibility and hashed account binding; after durable grant, consume top-ups or acknowledge subscriptions.
- User-specific idempotent voice credits, exact remaining millisecond balances, and native Android purchase/restore flows added.
- Server-controlled Phonic WebSocket relay reserves credit atomically; new reservation extends a long call without reconnecting. Each lease has a provider-independent hard cutoff if no further minutes are available.
- Existing free voice remains unchanged when `MSS_VOICE_BILLING_ENABLED` is unset, and billing can be tested on specific accounts without changing all users.

## Deployment structure

Render **synqme-api** auto-deploys GitHub branch `SYNQ.ME`. The backend work is PR #37 to `SYNQ.ME`, and includes the production OTA-artifact routing behavior.

Android code is PR #36, based on `mobile/current-mss`.
- Android tester bundle versionCode 10, versionName 1.7.
- `android-test` and `android-play` Codemagic workflows build with `VITE_PLAY_BILLING_ENABLED=true`; older Android builds do not expose the new purchase screen.
- The mobile UI checks `GET /health` and `GET /api/billing/status` before enabling a purchase. Backend returns `paidVoiceEnabled=false` until a billing flag or test allowlist is present.

## Safe tester-only rollout

1. Leave Render variable `MSS_VOICE_BILLING_ENABLED` **unset** or `false`.
2. Add `MSS_VOICE_BILLING_TEST_EMAILS` to the backend **only with verified MSS accounts belonging to Google Play license testers**; comma-separated lowercase email addresses.
3. Save environment config. Only allowlisted users receive metered voice sessions; other users keep legacy voice sessions. Public health reports billing availability to the tester-enabled Android app.
4. Build a signed versionCode 10 AAB through Codemagic `android-play` and upload to Google Play **closed testing**, not production. Use matching tester account on installed Play version.
5. Validate `mss_premium` subscription and all four top-ups with Google Play test payment methods. Verify:
   - token matches signed-in MSS account; wrong-account tokens fail
   - pending/cancelled purchases grant nothing
   - each token grants exactly once, including after restore and reinstall
   - credits display immediately; minutes debit during connected voice
   - long session continues past 5 minutes when balance remains
   - session stops on exhaustion; top-ups survive renewal/cancellation
   - multiple devices cannot reserve overlapping credit
   - provider disconnect / backend failure refunds unused reserved time
   - local price and billing disclosures are correct.
6. Inspect Render logs for Play verification errors (never log raw tokens), and inspect Supabase grants and voice leases for duplicates or unexpected balances.

## Before general customer launch

- Add Real-time Developer Notifications / scheduled subscription reconciliation for renewals, reversals, chargebacks, refunds and cancellation while app is closed. Current subscription renewal is applied when native client re-verifies purchases on sign-in; this is not yet a complete unattended reconciliation system.
- Test the relay against a real Phonic WebSocket conversation, including duration rollover and abrupt disconnects.
- Confirm correct on-device purchase UI and complete signed AAB closed-track testing.
- Decide launch policy for existing users and versions that do not yet display Google Play checkout.
- Add iOS App Store subscription and consumable products separately before enabling iOS checkout.
- Enable global `MSS_VOICE_BILLING_ENABLED=true` only after the above tests, release readiness and migration have been confirmed.

## Security

Google service account JSON and Supabase secret key are server-only. Never put either in app source, build variables prefixed with `VITE_`, screenshots or messages. The client only sends purchase IDs/tokens through authenticated endpoints and cannot write balances. The Google token is stored as a SHA-256 hash for idempotent ownership checks; the backend verifies with Google for each purchase.
