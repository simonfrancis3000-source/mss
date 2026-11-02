import test from "node:test";
import assert from "node:assert/strict";
import { validateLiveUpdateManifest } from "../src/ota-manifest.js";

const checksum = "a".repeat(64);
const bundleId = "mss-" + checksum.slice(0, 32);
const good = {
  enabled: true,
  platform: "android",
  channel: "internal",
  bundleId,
  checksum,
  url: "https://synqme-api.onrender.com/ota/" + bundleId + ".zip",
  minNativeVersionCode: 4,
  maxNativeVersionCode: 4
};

test("accepts only matching native versions and verified bundle ID", () => {
  assert.deepEqual(validateLiveUpdateManifest(good, "android", 4), {
    bundleId, checksum, url: good.url
  });
  assert.equal(validateLiveUpdateManifest(good, "android", 3), null);
  assert.equal(validateLiveUpdateManifest(good, "ios", 4), null);
});
test("disabled and tampered manifests never stage an update", () => {
  for (const patch of [
    {enabled: false}, {channel: "production"}, {checksum: "b".repeat(64)},
    {bundleId: "other"}, {url: "https://evil.example/bundle.zip"},
    {url: good.url + "?token=1"}, {minNativeVersionCode: 5},
    {maxNativeVersionCode: 3}, {maxNativeVersionCode: "4"}
  ]) {
    assert.equal(validateLiveUpdateManifest({...good, ...patch}, "android", 4), null);
  }
});
