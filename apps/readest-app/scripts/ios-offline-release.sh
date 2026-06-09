#!/usr/bin/env bash
#
# Build Readest as an OFFLINE iOS app and install it on the connected iPhone.
#
# Uses `tauri ios build` (not raw xcodebuild) because the Xcode pre-build
# script (tauri ios xcode-script) needs the Tauri CLI's IPC server running —
# calling xcodebuild directly causes a "Connection refused" panic.
#
# After install: put the phone in AIRPLANE MODE and reopen the app to confirm it
# loads with no server reachable.
#
set -euo pipefail

export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

APP_DIR="/Users/jose/Developer/readest/apps/readest-app"
IPA_PATH="$APP_DIR/src-tauri/gen/apple/build/arm64/Readest.ipa"
BUNDLE_ID="com.ecconvert.readest"
DEVICE="${READEST_IOS_DEVICE:-D59CE43A-37C0-5B90-8013-D48E6FEED550}"  # Jose's iPhone 16 Pro Max

cd "$APP_DIR"

echo "==> 1/3  Building web app + Rust + packaging IPA (release, embeds out/)"
pnpm tauri ios build --export-method debugging --ci

echo "==> 2/3  Installing on device $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$IPA_PATH"

echo "==> 3/3  Launching"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE_ID"

cat <<'DONE'

Done.  Now verify offline:
  1. Turn ON Airplane Mode (and confirm Wi-Fi is off).
  2. Force-quit and reopen Readest.
  3. It should fully load and let you read with NO server running.
DONE
