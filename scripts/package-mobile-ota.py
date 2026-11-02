#!/usr/bin/env python3
"""Package a reviewed mobile Vite build for self-hosted Capawesome OTA testing.

This script generates files only; it never publishes or activates a bundle.
Run from the repository root after: npm run build -- --mode mobile
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "ota-publish"
API = "https://synqme-api.onrender.com/ota/"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=("android", "ios"), default="android")
    parser.add_argument("--native-code", type=int, required=True)
    parser.add_argument("--channel", choices=("internal",), default="internal")
    args = parser.parse_args()
    if args.native_code < 1:
        parser.error("--native-code must be positive")
    index = DIST / "index.html"
    if not index.is_file():
        parser.error("dist/index.html not found: build in mobile mode first")
    html = index.read_text(encoding="utf-8")
    if "./assets/" not in html:
        parser.error("Build is not configured with the mobile relative asset base")
    files = sorted(path for path in DIST.rglob("*") if path.is_file())
    if not files:
        parser.error("dist is empty")
    if any(path.is_symlink() for path in files):
        parser.error("dist must not contain symlinks")
    OUT.mkdir(exist_ok=True)
    tmp = OUT / "candidate.zip"
    # ZIP the contents of dist, not the dist directory itself: index.html at root.
    with ZipFile(tmp, "w", ZIP_DEFLATED, compresslevel=7) as z:
        for file in files:
            relative = file.relative_to(DIST).as_posix()
            if relative.startswith("ota/"):
                continue
            z.write(file, arcname=relative)
    size = tmp.stat().st_size
    if size > 50 * 1024 * 1024:
        tmp.unlink(missing_ok=True)
        parser.error("OTA archive exceeds the 50 MB Render delivery limit")
    sha = hashlib.sha256(tmp.read_bytes()).hexdigest()
    bundle_id = "mss-" + sha[:32]
    final = OUT / f"{bundle_id}.zip"
    os.replace(tmp, final)
    manifest = {
        "enabled": True,
        "channel": args.channel,
        "platform": args.platform,
        "bundleId": bundle_id,
        "url": API + final.name,
        "checksum": sha,
        "minNativeVersionCode": args.native_code,
        "maxNativeVersionCode": args.native_code
    }
    manifest_path = OUT / f"{args.channel}-{args.platform}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Created {final} ({size} bytes)")
    print(f"Created {manifest_path}")
    print("NOT PUBLISHED. Review and test the bundle before copying it to ota-bundles/.")

if __name__ == "__main__":
    main()
