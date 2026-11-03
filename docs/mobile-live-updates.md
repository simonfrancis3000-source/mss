# MSS live updates (internal testing)

The Android/iOS shell uses **Capawesome Live Update 8** in self-hosted mode. It checks
`https://synqme-api.onrender.com/ota/internal-android.json` at launch and never
interrupts a Phonic voice call with a forced reload. An approved update is staged
for the **next full app launch**, while the built-in app remains available if the
network fails. The channel is **DISABLED** unless its manifest says `enabled: true`.

## Initial one-time native build

From Codespaces on `mobile/current-mss`:

```bash
git pull --ff-only
npm install
npx cap sync android
npx cap sync ios
npm run build -- --mode mobile
git add package-lock.json android ios
git commit -m "Sync Capawesome native plugins and lockfile"
git push
```

Publish the Android **1.5 (versionCode 8)** AAB via the existing Codemagic
`android-play` workflow with `mss_upload`. A native app-store update is
required to install the plugin. Do not use the OTA channel for native SDK,
permission, Info.plist, Capacitor plugin, WebView cookie settings, or app entitlement changes.
Android 1.5 adds WebView settings for the Cloudflare Turnstile login bridge. It must be installed before enabling Supabase CAPTCHA enforcement for mobile users.

## Package an OTA web-only update

1. Incorporate the latest reviewed MSS UI changes into the mobile branch.
2. Run tests, then `npm run build -- --mode mobile`.
3. Run `python3 scripts/package-mobile-ota.py --platform android --native-code 7`.
4. Inspect `ota-publish/`: a zip with `index.html` at root and
   `internal-android.json`. Keep source maps, tokens, and private files out of
   public bundles. The script validates the relative Vite asset base and prints
   the bundle SHA-256 checksum.
5. To **publish only after internal approval**, place the generated ZIP and JSON
   in `ota-bundles/` on the **SYNQ.ME branch** and push. The Render API must be
   deployed from the branch containing `server/index.js` and the OTA files;
   check that the endpoints return 200. Use `git pull --ff-only` before any
   publish, and do not overwrite unrelated website changes.
6. Launch the native app. It downloads and verifies the SHA-256 ZIP in the
   background, then uses it after a full app restart.

## Rollback / disable

Set `ota-bundles/internal-android.json` on the Render deployment branch back
to `{"enabled":false,"channel":"internal","platform":"android"}` and deploy
to prevent new installs. **This does not revert devices already on an update.**
For those devices, publish and stage a tested replacement bundle (new ID) or
ship a native Google Play update. Native rollback is also configured: a bundle
that cannot mark itself ready within 15 seconds resets to the installed bundle.
Blocked rolled-back IDs are skipped by the mobile update checker.

## Security and production

- The server only serves the two internal manifests and ZIPs with strict
  SHA-derived filenames, with CORS restricted to allowed origins.
- The client requires HTTPS on the known MSS API domain, an exact 64-hex
  checksum, a matching bundle ID and an exact native version-code range.
- The app uses `ready()` before any update calls. Update failures never block
  sign-in or voice. No automatic update publishing is configured.
- **Before public production**, add RSA bundle signing and embed the public
  key in `capacitor.config.json`; SHA-256 plus HTTPS alone does not protect
  against a compromised manifest origin. Use separate tester and production
  channels, signed release approval and controlled rollouts. Capawesome Cloud
  is an optional later improvement, not required for self-hosted ZIPs.
