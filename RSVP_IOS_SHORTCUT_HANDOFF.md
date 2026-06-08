# RSVP iOS Shortcut Handoff

## Current State

Repository: `/Users/jose/Developer/readest`

Branch: `feat/rsvp-improvements`

Last pushed commit on branch:

```text
22a4db9b feat(rsvp): stay in speed-read at chapter end, top-bar icon, quiz review, latest-book deep link
```

Current working tree has uncommitted changes from this session:

```text
M apps/readest-app/src-tauri/Info-ios.plist
M apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift
M apps/readest-app/src/app/reader/components/ReaderContent.tsx
M apps/readest-app/src/app/reader/components/rsvp/RSVPControl.tsx
```

Important: the generated iOS plist at `apps/readest-app/src-tauri/gen/apple/Readest_iOS/Info.plist` was also edited locally so the current Xcode project sees the shortcut, but it is generated/ignored and does not appear in `git status`. The persistent source plist is `apps/readest-app/src-tauri/Info-ios.plist`.

## What Existed Before This Session

The branch already contained the broader RSVP work:

- Chapter-end RSVP fix: closing/finishing/declining the comprehension quiz keeps RSVP paused and then resumes into the next chapter instead of exiting speed-read mode.
- Top-bar RSVP speedometer icon, disabled for fixed-layout books.
- Wrong-answer "Ask AI to review this question" button.
- Web deep link for latest book speed reading.
- Lint was clean on the branch before this iOS/Xcode work.

## What Changed During This Session

### 1. Apple Developer / Xcode Build Path

The user’s paid Apple Developer account was approved and selected in Xcode.

Device:

```text
Jose's iPhone
D59CE43A-37C0-5B90-8013-D48E6FEED550
iPhone 16 Pro Max
```

Builds that previously failed under a Personal Team now build and sign with:

```text
Apple Development: jose.elva.2013@gmail.com (GP7WJ8A3S5)
Team ID: XP274S4V78
Bundle ID: com.ecconvert.readest
```

Successful device build command:

```bash
xcodebuild -project apps/readest-app/src-tauri/gen/apple/Readest.xcodeproj \
  -scheme Readest_iOS \
  -configuration debug \
  -destination 'id=D59CE43A-37C0-5B90-8013-D48E6FEED550' \
  build
```

Install command:

```bash
xcrun devicectl device install app \
  --device D59CE43A-37C0-5B90-8013-D48E6FEED550 \
  /Users/jose/Library/Developer/Xcode/DerivedData/Readest-bvbkgxlqmgpxnjbydubgdjgxfblw/Build/Products/debug-iphoneos/Readest.app
```

Launch command:

```bash
xcrun devicectl device process launch \
  --device D59CE43A-37C0-5B90-8013-D48E6FEED550 \
  --terminate-existing \
  com.ecconvert.readest
```

### 2. Native Home Screen Quick Action

Added a static iOS Home Screen Quick Action:

```text
Title: Speed Read Latest
Type: com.ecconvert.readest.speed-read-latest
Icon: UIApplicationShortcutIconTypePlay
URL: tauri://localhost/reader?ids=latest&rsvp=resume
```

Source file:

```text
apps/readest-app/src-tauri/Info-ios.plist
```

Why the URL uses `/reader?ids=latest&rsvp=resume`:

- The Tauri webview loads a static export.
- The static build emits `reader.html`, not `reader/latest.html`.
- `/reader/latest?rsvp=resume` can flash and fall back to the menu under static export.
- Query-form `/reader?ids=latest&rsvp=resume` is static-export-safe and is understood by the existing reader code.

### 3. Native Shortcut Handler

Updated:

```text
apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift
```

What it does:

- Defines `speedReadLatestShortcutType` and fallback URL.
- Handles `UIApplicationShortcutItem` in both:
  - `application(_:didFinishLaunchingWithOptions:)`
  - `application(_:performActionFor:completionHandler:)`
- Queues the shortcut URL if the Tauri plugin receives it before the `WKWebView` exists.
- Navigates the already-loaded web app with:

```swift
window.location.assign("/reader?ids=latest&rsvp=resume")
```

instead of trying to load an absolute `tauri://localhost/...` page directly.

Why this matters:

- A cold-launch shortcut can arrive before `NativeBridgePlugin.load(webview:)`.
- Directly loading `tauri://localhost/reader/latest` was brittle with static export.
- Browser-style route assignment works in dev/prod because it preserves the current webview origin.

### 4. Latest Book Resolution Fallback

Updated:

```text
apps/readest-app/src/app/reader/components/ReaderContent.tsx
```

`ids=latest` now resolves in this order:

1. First valid `settings.lastOpenBooks` entry that still exists in the library.
2. Most recently updated visible library book.

Why this was needed:

- Fresh iOS installs or newly deployed mobile shells can have missing/stale `lastOpenBooks`.
- Without a fallback, `/reader?ids=latest&rsvp=resume` could open an empty reader and bounce back to the library/main menu.

### 5. RSVP Auto-Resume Precision Fix

Updated:

```text
apps/readest-app/src/app/reader/components/rsvp/RSVPControl.tsx
```

Bug:

- The shortcut auto-start path for `rsvp=resume` called `controller.startFromCurrentPosition()`.
- `startFromCurrentPosition()` clears the saved RSVP word position.
- That caused the shortcut to resume from normal reader progress, which can be a chapter/page boundary behind the exact RSVP word position.

Fix:

- If `rsvp=resume` and there is a saved RSVP position, call `controller.startFromSavedPosition()`.
- If the saved CFI is in a different section, listen for `rsvp-navigate-to-resume`, call `view.goTo(cfi)`, then start RSVP after navigation.
- If there is no saved RSVP position, fall back to `startFromCurrentPosition()`.

User verified this fixed the "starts a chapter behind" behavior.

## Deployment Performed

Built static web output:

```bash
cd /Users/jose/Developer/readest/apps/readest-app
pnpm build
```

Deployed to home server:

```bash
rsync -az --delete out/ jose@traijn.taila380c.ts.net:~/readest-app/
```

Verified server route:

```bash
curl -I 'http://100.96.87.88:3001/reader?ids=latest&rsvp=resume'
```

Latest verified server timestamp:

```text
Last-Modified: Mon, 08 Jun 2026 18:05:04 GMT
```

## Verification

Passed:

```bash
plutil -lint apps/readest-app/src-tauri/Info-ios.plist apps/readest-app/src-tauri/gen/apple/Readest_iOS/Info.plist
pnpm lint
pnpm build
xcodebuild -project apps/readest-app/src-tauri/gen/apple/Readest.xcodeproj -scheme Readest_iOS -configuration debug -destination 'id=D59CE43A-37C0-5B90-8013-D48E6FEED550' build
```

Notes:

- `pnpm lint` reports `luajit not found, skipping koplugin syntax check`; this is expected locally. CI runs that check unconditionally.
- Xcode build emits a warning that the ShareExtension `CFBundleVersion` is `1` while the parent is `null`; it did not block build/install.
- Earlier full test suite issues were tied to Node 25/localStorage behavior. Node 22 LTS remains the recommended follow-up for stable tests.

User live-tested on iPhone:

- Long-press Readest icon.
- Tap `Speed Read Latest`.
- App opens latest book.
- RSVP starts automatically.
- It now resumes at the expected saved RSVP position.

## Lessons Learned / Gotchas

### The phone loads the deployed server, not only the local native bundle

The Tauri iOS shell is configured with:

```json
"devUrl": "http://100.96.87.88:3001"
```

So native reinstall alone is not enough when the changed logic lives in the Next.js web bundle. During debugging, the server was still serving a June 6 build, which explained the black flash back to the menu. Deploying `out/` fixed that.

### Static export route shape matters

`/reader/latest?rsvp=resume` was conceptually nice but static-export-hostile. The safe route is:

```text
/reader?ids=latest&rsvp=resume
```

### Generated iOS files are not the source of truth

Use `apps/readest-app/src-tauri/Info-ios.plist` for source changes. The generated plist was patched locally only so the already-open Xcode project/install reflected the change immediately.

## Recommended Next Steps

1. Commit the four tracked changes:

```bash
git add \
  apps/readest-app/src-tauri/Info-ios.plist \
  apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift \
  apps/readest-app/src/app/reader/components/ReaderContent.tsx \
  apps/readest-app/src/app/reader/components/rsvp/RSVPControl.tsx \
  RSVP_IOS_SHORTCUT_HANDOFF.md

git commit -m "feat(rsvp): add iOS speed-read latest shortcut"
```

2. Push branch:

```bash
git push --no-verify origin feat/rsvp-improvements
```

3. Optional cleanup:

- Consider removing or downgrading the temporary native `print(...)` in `NativeBridgePlugin.swift` once the shortcut is fully trusted.
- Pin Node 22 LTS via `.nvmrc` / `engines` to avoid Node 25 test harness issues.
- Revisit associated-domains entitlements if universal links are needed later. The current Home Screen Quick Action does not depend on associated domains.

## If A Future Session Needs To Reproduce

1. Build and deploy web:

```bash
cd /Users/jose/Developer/readest/apps/readest-app
pnpm build
rsync -az --delete out/ jose@traijn.taila380c.ts.net:~/readest-app/
```

2. Build/install iOS:

```bash
cd /Users/jose/Developer/readest
xcodebuild -project apps/readest-app/src-tauri/gen/apple/Readest.xcodeproj \
  -scheme Readest_iOS \
  -configuration debug \
  -destination 'id=D59CE43A-37C0-5B90-8013-D48E6FEED550' \
  build

xcrun devicectl device install app \
  --device D59CE43A-37C0-5B90-8013-D48E6FEED550 \
  /Users/jose/Library/Developer/Xcode/DerivedData/Readest-bvbkgxlqmgpxnjbydubgdjgxfblw/Build/Products/debug-iphoneos/Readest.app
```

3. Test on iPhone:

```text
Home Screen -> long-press Readest -> Speed Read Latest
```

