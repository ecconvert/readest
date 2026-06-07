# Readest RSVP — Session Handoff

## What the project is

**Readest** — open-source EPUB reader, Next.js 16 + Tauri v2 pnpm monorepo.
Jose runs a custom static build served from a home server; an iOS native WKWebView app points to it.
The RSVP (Rapid Serial Visual Presentation) speed-reading mode is the main feature being extended.

**Goal**: Use Readest's RSVP mode to speed-read the NRSVue Bible EPUB with per-chapter navigation,
a clean reading flow (no verse numbers/footnotes), optional AI comprehension quizzes, and proper
visual formatting in the context panel.

---

## Repository & infrastructure

| Thing | Value |
|---|---|
| Repo | `/Users/jose/Developer/readest/` |
| App dir | `apps/readest-app/` |
| Build command | `pnpm build` (uses `.env.tauri` → static export → `out/`) |
| Deploy | `rsync -az out/ jose@traijn.taila380c.ts.net:~/readest-app/` |
| Server | Docker container `readest` (port 3001), nginx, bind-mount `~/readest-app` |
| iOS | Xcode WKWebView app pointing to `http://traijn.taila380c.ts.net:3001` |
| Tests | `pnpm exec vitest run <file>` (jsdom, NOT `pnpm test` — runs whole suite) |
| Lint | `pnpm lint` (Biome + tsgo) |

**⚠️ Do NOT use `pnpm build-web`** — that produces a standalone server build, not the static
export the Docker setup needs.

---

## RSVP core files

| File | Purpose |
|---|---|
| `src/services/rsvp/RSVPController.ts` | Engine: word extraction, chapter tracking, playback |
| `src/services/rsvp/types.ts` | `RsvpWord`, `RsvpState`, etc. |
| `src/services/rsvp/utils.ts` | `splitTextIntoWords`, CJK helpers |
| `src/app/reader/components/rsvp/RSVPControl.tsx` | React wrapper: start/stop, chapter select, AI quiz |
| `src/app/reader/components/rsvp/RSVPOverlay.tsx` | UI: flashing word, context panel, chapter label |
| `src/__tests__/services/rsvp-controller.test.ts` | Unit tests (33 tests, all passing) |

---

## Key architecture: word extraction

`extractWordsFromElement()` in `RSVPController.ts` walks the EPUB DOM and builds `RsvpWord[]`:

- Each word is tagged with **`chapterHref`** — updated when the walker enters an element whose `id`
  matches a TOC fragment (e.g. `id="ch01001"` → `"text/part0007.html#ch01001"`).
- `chapterAnchors` Map is populated by `setToc()` from the book's TOC items.
- **`isNewBlock?: boolean`** — set `true` on the first word after a block boundary (`P`, headings,
  `LI`, `BLOCKQUOTE`, `PRE`, `TD/TH`, `BR`). The context panel renders a `<br />` before these
  words so poems and blockquotes preserve their visual structure.

**`getChapterWordsAt(index)`** — returns words from chapter start up to `index` (not the full
chapter). Used by the AI quiz so it only sends what the user has actually read.

---

## Key architecture: chapter selection

`handleChapterSelect(href)` in `RSVPControl.tsx`:
1. Registers a `relocate` listener on the foliate view
2. Calls `view.goTo(href)` → reader navigates to the right spine section
3. On `relocate` (or 300 ms fallback for same-section navigation): calls
   `controller.loadNextPageContent(0, href)`
4. `loadNextPageContent` seeks to the first word tagged with that `chapterHref`

---

## Bugs fixed (across recent sessions)

| Bug | Fix location |
|---|---|
| Chapter label showed wrong chapter after dropdown selection | `RSVPControl.tsx` → `handleChapterSelect` passes `targetChapterHref` |
| AI quiz sent future (unread) chapter text | `RSVPController.ts` → `getChapterWordsAt` caps at `index+1` not chapter end |
| Debug logs not appearing | Use `pnpm build`, not `pnpm build-web` |
| rsync deploying to wrong directory | Deploy to `~/readest-app/`, not `/var/www/readest/` |
| Context panel showed flat text (no poem/quote formatting) | `isNewBlock` on `RsvpWord` + `<br>` in `RSVPOverlay` context panel |
| `localStorage.getItem is not a function` (29 test failures) | Added in-memory mock in `beforeEach` of `rsvp-controller.test.ts` |

---

## Bible EPUB preprocessing

Script: `/Users/jose/Developer/bible_rsvp_prep.py`
Output: `~/Downloads/NRSVue_rsvp.epub`

What it does:
- Strips `<span class="ver/ver-f">` verse number spans
- Strips `<a class="fnref">` footnote markers
- Unwraps `<a class="xref">` cross-references (keeps text)
- Rebuilds `toc.ncx` with per-chapter child navPoints so Readest's chapter dropdown shows
  Genesis 1, Genesis 2, … instead of just "Genesis"

Chapter anchor pattern in HTML: `<div class="chapter" id="ch{BB}{CCC}">` where BB = 2-digit book,
CCC = 3-digit chapter (e.g. `ch01034` = Genesis 34).

---

## AI comprehension quiz

Fires at:
- `rsvp-chapter-end` event (chapter boundary inside a spine section)
- `rsvp-request-next-page` event (spine section end)
- Manual quiz button tap

Sends: `pendingQuizWordsRef.current ?? controller.getCurrentChapterWords()`  
Uses OpenRouter. **API key must NEVER be committed** — public repo, auto-revoked by scanners.

---

## Known limitations / watch-outs

1. **WKWebView cache** — iOS caches aggressively. New chunk names (content-hashed) force fresh
   fetches. If deploy goes to the wrong directory, nothing updates.
2. **Same-spine-section chapters** — Bible packs many chapters into one HTML file; handled by the
   `chapterHref` tagging per word.
3. **Pre-anchor words** — Words before the first TOC anchor in a spine file get
   `chapterHref = undefined` (normal "overflow" from previous section).
4. **`isNewBlock` on ISI blank frames** — The `' '` spacer inserted between two identical
   consecutive words does not carry `isNewBlock`; the next real word's flag is preserved.
