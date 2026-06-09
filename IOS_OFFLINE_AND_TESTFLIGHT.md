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

`pnpm dev-ios` / `pnpm tauri ios dev` uses the debug configuration — the installed
app loads the UI from the home server. The fix is to build in **release** via
`pnpm tauri ios build`.

**Important:** never call `xcodebuild` directly. The Xcode pre-build phase runs
`tauri ios xcode-script`, which connects to a Tauri CLI IPC server. That server is
only started by `tauri ios build` / `tauri ios dev` — calling `xcodebuild` directly
causes a "Connection refused" panic and a build failure.

Key facts:
- Team ID: `XP274S4V78` (already in `project.yml` for both targets)
- Bundle IDs: `com.ecconvert.readest` (app) + `com.ecconvert.readest.ShareExtension`
- Device: Jose's iPhone 16 Pro Max — `D59CE43A-37C0-5B90-8013-D48E6FEED550`
- App Store Connect API Key ID: `VXB9L4YZY7`
- App Store Connect Issuer ID: `04a23dea-5b6b-4375-9290-bcd31594c79f`
- API Key file: `~/.appstoreconnect/private_keys/AuthKey_VXB9L4YZY7.p8`

---

## Option A — Offline build to your own device (fastest)

```bash
apps/readest-app/scripts/ios-offline-release.sh
```

It runs `pnpm tauri ios build --export-method debugging --ci`, installs the IPA to
your device, and launches the app. Release embeds `out/` for full offline use.
Turn on Airplane Mode and reopen to confirm offline.

If signing errors: open `gen/apple/Readest.xcodeproj` in Xcode, select both the
`Readest_iOS` and `ShareExtension` targets → Signing & Capabilities → enable
"Automatically manage signing" with team `XP274S4V78`, build once, then re-run
the script.

---

## Option B — TestFlight (over-the-air updates, no cable)

> **Private use only (Jose + wife).** Not going to the public App Store —
> TestFlight is just the delivery channel. Builds expire after 90 days.

### One-time setup (human — the agent can't do these)
1. **App Store Connect app record:** https://appstoreconnect.apple.com → Apps → +
   → New App. Platform iOS, bundle ID `com.ecconvert.readest`.
2. **App Store Connect API key** already done: `AuthKey_VXB9L4YZY7.p8` is at
   `~/.appstoreconnect/private_keys/`. The Issuer ID is on the App Store Connect
   → Users and Access → Integrations → App Store Connect API page.

### Build + upload
```bash
cd apps/readest-app

# Bump build number first (App Store Connect rejects duplicate build numbers)
# Edit package.json: increment the build number

pnpm tauri ios build --export-method app-store-connect --ci

xcrun altool --upload-app --type ios \
  --file src-tauri/gen/apple/build/arm64/Readest.ipa \
  --apiKey VXB9L4YZY7 \
  --apiIssuer 04a23dea-5b6b-4375-9290-bcd31594c79f
```

After uploading, the build appears in App Store Connect → TestFlight in ~5–15 min.

### Build number vs version
- **Version** (`package.json` → `"version"`) is the user-visible string (e.g. `0.11.4`).
- **Build number** is what App Store Connect deduplicates on. Tauri uses the version
  string as the build number. Bump version in `package.json` for each upload, or
  use `--build-number` flag: `pnpm tauri ios build --build-number 42 ...`

---

## App Icon

The correct Readest icon source is `src-tauri/icons/ios/`. The `gen/apple/` icon
asset catalog (`Assets.xcassets/AppIcon.appiconset/`) must match — copy if they
diverge (e.g. after `tauri ios init` regenerates `gen/`):

```bash
cp src-tauri/icons/ios/*.png src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/
```

---

## Caveats
- **Don't `tauri ios init` casually** — it regenerates `gen/apple/` from scratch,
  resetting the icon asset catalog to Tauri's placeholder. Re-copy icons after any
  regen (see above).
- **Don't call `xcodebuild` directly** — always go through `pnpm tauri ios build`
  or `pnpm tauri ios dev` so the Tauri IPC server is running for the pre-build script.
- Offline = content updates require a rebuild+reinstall (Option A) or a TestFlight
  upload (Option B).
- The home server is now **optional**: keep it only for `tauri dev` live-reload on
  desktop/browser.
