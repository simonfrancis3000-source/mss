# MySecondSelf: Cloudflare Turnstile activation

The web `main` branch and the mobile `mobile/current-mss` branch include Turnstile UI and pass `captchaToken` to Supabase for **sign-in, sign-up, and password-recovery requests**. Password *update* after clicking a recovery link remains unchanged.

**Important:** This code is deliberately opt-in. Until a real site key is provided at build time, it does not display a challenge or change existing sign-in behavior. A browser challenge alone is not protection: Supabase must verify the token server-side.

## Provisioning

1. Create a **Cloudflare Turnstile** widget in your Cloudflare account. The production hostname is `synqme.mysecondself.app`. Copy the widget's **Site Key** and **Secret Key**.
2. Set **`VITE_TURNSTILE_SITE_KEY`** (public site key only) in the build/deployment environment for the web app, and for any mobile/OTA bundles. This is a Vite build-time variable and requires a fresh build. Do **not** put the Secret Key in this variable or commit it to GitHub.
3. Deploy a frontend build containing the site key **before** enabling server-side CAPTCHA. Verify the challenge can be completed on web sign-in, sign-up and Forgot password, and that an actual `captchaToken` is sent for each action.
4. On the MySecondSelf Supabase project (`ltqbjqtzsdzglswuqkip`), open **Authentication > Bot and Abuse Protection** (Auth CAPTCHA settings), enable CAPTCHA, select **Cloudflare Turnstile**, and enter the **Secret Key**. Save.
5. Test with a **real email inbox**: create/confirm a new account, sign in, request a password-reset email, follow it, set a new password, and sign in again. Check failed and repeated attempts, and verify server-side rejection of requests with no valid token.
6. Review Supabase Auth logs for successful requests and CAPTCHA failures. Do not use `example.com` addresses for email tests.

## Capacitor Android/iOS

Cloudflare Turnstile runs in a WebView, not as a native SDK. Confirm `challenges.cloudflare.com` is reachable and JavaScript and DOM storage are enabled. Capacitor's default embedded local origin may not match the Cloudflare widget's hostname allowlist. Test a real Android/iOS build before enabling Supabase-wide CAPTCHA, or use a properly hosted authentication page for the native flow. Do not assume browser success implies native success. Avoid allowing local hostnames on a production Cloudflare widget unless the mobile architecture specifically requires and validates them.

## Security/rollout notes

- The Cloudflare **Secret Key** belongs only in Supabase's private CAPTCHA provider configuration. Only the public site key is bundled in Vite.
- Supabase enforces CAPTCHA for the configured authentication flows; client-side controls without that setting do not stop direct API calls.
- Tokens expire and are single-use. The frontend resets its challenge after an auth request.
- Roll out all supported clients before turning on the project-wide requirement, or older clients without token support can be locked out.
- Turnstile is not a replacement for Supabase rate limits.

References:
- https://supabase.com/docs/guides/auth/auth-captcha
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/
