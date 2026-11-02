# MySecondSelf: Cloudflare Turnstile activation

The production web deployment `synqme-demo` uses branch `SYNQ.ME`. Turnstile now sends `captchaToken` from this branch for **sign-in (including the admin portal), sign-up, and password-recovery requests**. The separate Android app uses `mobile/current-mss` and must be verified independently before project-wide enforcement. Password *update* after clicking a recovery link remains unchanged.

**Important:** The public site key supplied by the owner is now configured as a fallback in `src/auth-turnstile.js`. It activates on `synqme.mysecondself.app` after deployment, or on other explicitly configured builds using `VITE_TURNSTILE_SITE_KEY`. Local Capacitor WebViews are deliberately excluded from the fallback to avoid locking out existing mobile app users. A browser challenge alone is not protection: Supabase must verify tokens server-side.

## Provisioning

1. Create a **Cloudflare Turnstile** widget in your Cloudflare account. The production hostname is `synqme.mysecondself.app`. Copy the widget's **Site Key** and **Secret Key**.
2. The public Site Key is already in the source fallback and does **not** need a separate web build variable. For additional tested hostnames, set **`VITE_TURNSTILE_SITE_KEY`** (public Site Key only) at build time. Do **not** put the Secret Key in this variable or commit it to GitHub.
3. Deploy the updated Render `synqme-demo` static site from branch **`SYNQ.ME`** before enabling server-side CAPTCHA. Verify the challenge can be completed on web sign-in, admin sign-in, sign-up and Forgot password, and that an actual `captchaToken` is sent for each action.
4. On the MySecondSelf Supabase project (`ltqbjqtzsdzglswuqkip`), open **Authentication > Bot and Abuse Protection** (Auth CAPTCHA settings), enable CAPTCHA, select **Cloudflare Turnstile**, and enter the **Secret Key**. Save.
5. Test with a **real email inbox**: create/confirm a new account, sign in, request a password-reset email, follow it, set a new password, and sign in again. Check failed and repeated attempts, and verify server-side rejection of requests with no valid token.
6. Review Supabase Auth logs for successful requests and CAPTCHA failures. Do not use `example.com` addresses for email tests.

## Capacitor Android/iOS

Cloudflare Turnstile runs in a WebView, not as a native SDK. Confirm `challenges.cloudflare.com` is reachable and JavaScript and DOM storage are enabled. Capacitor's default local origin is generally `localhost` and is not covered by the widget hostname `synqme.mysecondself.app`. The default fallback key is therefore **not enabled** on local-host native WebViews, to preserve existing mobile login while Supabase CAPTCHA remains off. **Do not enable project-wide Supabase CAPTCHA until the native login flow can also produce a valid token**; otherwise native users will be locked out. For native support, test a real Android/iOS build with a properly hosted authentication page or a separately verified mobile-compatible approach. Avoid authorizing local hostnames on production widgets.

## Security/rollout notes

- The Cloudflare **Secret Key** belongs only in Supabase's private CAPTCHA provider configuration. Only the public site key is bundled in the app. Never commit the Secret Key.
- Supabase enforces CAPTCHA for the configured authentication flows; client-side controls without that setting do not stop direct API calls.
- Tokens expire and are single-use. The frontend resets its challenge after an auth request.
- Roll out all supported clients before turning on the project-wide requirement, or older clients without token support can be locked out.
- Turnstile is not a replacement for Supabase rate limits.

References:
- https://supabase.com/docs/guides/auth/auth-captcha
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/
