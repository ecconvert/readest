#!/usr/bin/env bash
#
# Build Readest as an OFFLINE iOS app and install it on the connected iPhone.
#
# Why "release": Tauri's iOS pre-build script (`tauri ios xcode-script`, wired in
# gen/apple/project.yml) only EMBEDS the web build (apps/readest-app/out) into the
# app bundle in the *release* configuration. In *debug* it points the WKWebView at
# the dev server (devUrl in tauri.conf.json) — i.e. NOT offline. So an offline
# reader must be built in release.
#
# After install: put the phone in AIRPLANE MODE and reopen the app to confirm it
# loads with no server reachable.
#
set -euo pipefail

APP_DIR="/Users/jose/Developer/readest/apps/readest-app"
PROJECT="$APP_DIR/src-tauri/gen/apple/Readest.xcodeproj"
SCHEME="Readest_iOS"
CONFIG="release"
TEAM="XP274S4V78"
BUNDLE_ID="com.ecconvert.readest"
DEVICE="${READEST_IOS_DEVICE:-D59CE43A-37C0-5B90-8013-D48E6FEED550}"  # Jose's iPhone 16 Pro Max

cd "$APP_DIR"

echo "==> 1/4  Building the web app (static export -> out/) so it can be embedded"
pnpm build

echo "==> 2/4  Release build for device $DEVICE (embeds out/, signs for the device)"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$DEVICE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" \
  build

echo "==> 3/4  Locating the built .app"
APP_PATH="$(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -path '*/Build/Products/release-iphoneos/Readest.app' -type d 2>/dev/null | head -1)"
if [[ -z "${APP_PATH:-}" ]]; then
  echo "ERROR: could not find release Readest.app in DerivedData." >&2
  echo "Open the project in Xcode, fix signing for Readest_iOS + ShareExtension, build once, then re-run." >&2
  exit 1
fi
echo "    Found: $APP_PATH"

echo "==> 4/4  Installing + launching on device"
xcrun devicectl device install app --device "$DEVICE" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE_ID"

cat <<'DONE'

Done.  ✅  Now verify offline:
  1. Turn ON Airplane Mode (and confirm Wi-Fi is off).
  2. Force-quit and reopen Readest.
  3. It should fully load and let you read with NO server running.

If it fails to load offline, the build was not embedding out/ — make sure you
ran in RELEASE (this script does) and that `pnpm build` produced out/index.html.
DONE
