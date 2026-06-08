# Readest iOS — Offline Build & TestFlight

This is the reference for making the iPhone app run **fully offline** and for
shipping updates over-the-air via **TestFlight**. Written for Jose's fork.

## Background: why the app wasn't offline

`apps/readest-app/src-tauri/tauri.conf.json` sets `frontendDist: "../out"` (bundle
the web build) and `devUrl: "http://100.96.87.88:3001"` (dev server). The Xcode
project (`gen/apple/project.yml`) runs `tauri ios xcode-script` as a pre-build
step. Its behavior depends on configuration:

- **debug** → app points the WKWebView at `devUrl` (the home server). **Not offline.**
- **release** → app **embeds `out/`** and loads `tauri://localhost`. **Offline.**

The session-2 device build used `-configuration debug`, so the installed app was
loading the UI from the home server (its `gen/apple/assets/` bundle was empty).
The fix is simply to build in **release**. Books are already stored on-device; this
makes the *app shell* offline too.

Key facts:
- Team ID: `XP274S4V78` (already in `project.yml` for both targets)
- Bundle IDs: `com.ecconvert.readest` (app) + `com.ecconvert.readest.ShareExtension`
- Device: Jose's iPhone 16 Pro Max — `D59CE43A-37C0-5B90-8013-D48E6FEED550`

---

## Option A — Offline build to your own device (fastest)

```bash
apps/readest-app/scripts/ios-offline-release.sh
```

It runs `pnpm build`, does a **release** `xcodebuild` to the device (so `out/` is
embedded), installs, and launches. Then **turn on Airplane Mode and reopen** to
confirm offline. Release/dev signing lasts ~1 year on your paid account (no more
7-day expiry).

If signing errors: open `gen/apple/Readest.xcodeproj` in Xcode once, select the
`Readest_iOS` and `ShareExtension` targets → Signing & Capabilities → enable
"Automatically manage signing" with team `XP274S4V78`, build once, then re-run the
script.

---

## Option B — TestFlight (over-the-air updates, no cable)

Best long-term workflow for an app you maintain solo: upload once, then push
updates OTA; installs like a normal App Store app and is fully offline.

### One-time setup (human — the agent can't do these)
1. **App Store Connect app record:** https://appstoreconnect.apple.com → Apps → +
   → New App. Platform iOS, bundle ID `com.ecconvert.readest`, pick an SKU/name.
2. **Register App IDs / App Group** in the Developer portal if not already
   (automatic signing usually creates them): `com.ecconvert.readest`,
   `com.ecconvert.readest.ShareExtension`, and the shared App Group both targets use.
3. **App Store Connect API key** (so CLI/agent can upload without interactive
   login): App Store Connect → Users and Access → Integrations → App Store Connect
   API → generate key. Download `AuthKey_<KEYID>.p8`, note the **Key ID** and
   **Issuer ID**, and place the file at:
   `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`

### Export options for the App Store
Create `apps/readest-app/src-tauri/gen/apple/ExportOptions-AppStore.plist`
(the existing `ExportOptions.plist` is `debugging`, for device install only):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>XP274S4V78</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
```
(`destination: upload` makes `-exportArchive` push straight to TestFlight.)

### Build + upload
```bash
cd apps/readest-app
pnpm build

xcodebuild -project src-tauri/gen/apple/Readest.xcodeproj \
  -scheme Readest_iOS -configuration release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Readest.xcarchive \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=XP274S4V78 \
  archive

xcodebuild -exportArchive \
  -archivePath build/Readest.xcarchive \
  -exportOptionsPlist src-tauri/gen/apple/ExportOptions-AppStore.plist \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8 \
  -authenticationKeyID <KEYID> \
  -authenticationKeyIssuerID <ISSUER_ID>
```
Bump `version`/build number (in `package.json`, which `tauri.conf.json` reads) for
each upload or App Store Connect rejects duplicate builds. After processing
(~5–15 min) the build appears in TestFlight → install/update from the TestFlight app.

---

## Using Xcode 26.3's built-in Claude Agent

Xcode 26.3's agentic coding (Claude Agent) can run builds, archive, and drive the
TestFlight upload. Open the assistant in **agent mode**, make sure the one-time
setup above is done (app record + API key), then paste:

> **Prompt for the Xcode Claude agent:**
> You are working in the Readest iOS app (Tauri v2). Goal: ship an **offline**
> build and set up TestFlight.
>
> 1. Confirm the schemes/targets `Readest_iOS` and `ShareExtension` use automatic
>    signing with development team `XP274S4V78`. Bundle IDs are
>    `com.ecconvert.readest` and `com.ecconvert.readest.ShareExtension`.
> 2. Run `pnpm build` in `apps/readest-app` so the static web export `out/` is
>    fresh (the release build embeds it for offline use).
> 3. Do a **release** build of `Readest_iOS` to my connected iPhone
>    (`D59CE43A-37C0-5B90-8013-D48E6FEED550`), install, and launch it. Release is
>    required — debug points the webview at a dev server and is not offline.
> 4. Then archive for distribution and upload to **TestFlight** using my App Store
>    Connect API key (Key ID <KEYID>, Issuer <ISSUER_ID>, key at
>    `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`). Use export method
>    `app-store-connect`, team `XP274S4V78`. Bump the build number first.
> 5. Report any signing or provisioning errors and what you changed.
>
> Do NOT modify `src-tauri/Info-ios.plist`, the Swift sources, or the
> `UIApplicationShortcutItems` (the "Speed Read Latest" Home Screen quick action) —
> only signing/build settings as needed.

What the agent **can** do: builds, archive, export, upload, fix signing/build
settings, read Apple docs. What it **can't**: create the App Store Connect app
record, accept Apple agreements, or generate the API key — those are the one-time
human steps above.

---

## Caveats
- **Don't `tauri ios build`/`tauri ios init` casually** — it can regenerate the
  on-disk `Readest_iOS/Info.plist` from `src-tauri/Info-ios.plist`. The quick
  action lives in `Info-ios.plist` (tracked) so it should survive, but re-verify
  the Home Screen "Speed Read Latest" action after any regen.
- Offline = content updates require a rebuild+reinstall (Option A) or a TestFlight
  upload (Option B). No more `rsync` to the home server for the iPhone app.
- The home server is now **optional**: keep it only for `tauri dev` live-reload and
  for reading Readest in a desktop/other browser.
