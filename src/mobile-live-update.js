import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";

// Native-only self-hosted OTA updates. The built-in web bundle remains the fallback.
// We deliberately NEVER reload an active app or voice conversation.
const API_ORIGIN = "https://synqme-api.onrender.com";
const CHANNEL = "internal";
const REQUEST_TIMEOUT_MS = 8000;
const ID_PATTERN = /^mss-[a-f0-9]{32}$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

export function validateLiveUpdateManifest(manifest, platform, versionCode) {
  if (!manifest || manifest.enabled !== true || manifest.channel !== CHANNEL) return null;
  if (manifest.platform !== platform || !["android", "ios"].includes(platform)) return null;
  if (typeof manifest.bundleId !== "string" || !ID_PATTERN.test(manifest.bundleId)) return null;
  if (typeof manifest.checksum !== "string" || !CHECKSUM_PATTERN.test(manifest.checksum)) return null;
  if (manifest.bundleId !== "mss-" + manifest.checksum.slice(0, 32)) return null;
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) return null;
  const min = manifest.minNativeVersionCode;
  const max = manifest.maxNativeVersionCode;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) return null;
  if (versionCode < min || versionCode > max) return null;
  try {
    const url = new URL(manifest.url);
    if (url.origin !== API_ORIGIN || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/ota/" + manifest.bundleId + ".zip") return null;
    return { url: url.href, bundleId: manifest.bundleId, checksum: manifest.checksum };
  } catch {
    return null;
  }
}

async function fetchManifest(platform) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_ORIGIN + "/ota/" + CHANNEL + "-" + platform + ".json", {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null; // Missing manifest means OTA is not enabled.
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function bootMobileUpdates() {
  if (!Capacitor.isNativePlatform()) return;
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return;

  // A page that has not rendered basic UI elements should not be marked healthy.
  if (!document.querySelector("#authGate") || !document.querySelector("#appSplash")) return;
  try {
    const readiness = await LiveUpdate.ready(); // Always before changing a bundle.
    if (readiness.rollback) console.warn("MSS OTA: previous update rolled back.");
    const { versionCode } = await LiveUpdate.getVersionCode();
    const manifest = await fetchManifest(platform);
    const update = validateLiveUpdateManifest(manifest, platform, Number(versionCode));
    if (!update) return;

    const current = await LiveUpdate.getCurrentBundle();
    const next = await LiveUpdate.getNextBundle();
    if (update.bundleId === current.bundleId || update.bundleId === next.bundleId) return;

    // Don't repeatedly install a bundle the native rollback mechanism blocked.
    const blocked = await LiveUpdate.getBlockedBundles();
    if (blocked.bundleIds?.includes(update.bundleId)) return;

    await LiveUpdate.downloadBundle(update); // Native download verifies SHA-256.
    await LiveUpdate.setNextBundle({ bundleId: update.bundleId });
    console.info("MSS OTA: verified update staged for next app restart.");
  } catch (error) {
    // Never block sign-in, Journey, or Phonic when updates are unavailable.
    console.warn("MSS OTA: using the installed application bundle.", error);
  }
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void bootMobileUpdates(); }, { once: true });
  } else {
    void bootMobileUpdates();
  }
}
