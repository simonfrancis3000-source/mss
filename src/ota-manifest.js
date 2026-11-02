// Pure, dependency-free OTA manifest validation, shared by app and tests.
const API_ORIGIN = "https://synqme-api.onrender.com";
const ID_PATTERN = /^mss-[a-f0-9]{32}$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

export function validateLiveUpdateManifest(manifest, platform, versionCode) {
  if (!manifest || manifest.enabled !== true || manifest.channel !== "internal") return null;
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
