# RSVP Chapter Label Bug — Handoff Document

## Project Overview

**Readest** is a cross-platform ebook reader: Next.js 16 + Tauri v2, pnpm monorepo.
Working directory: `/Users/jose/Developer/readest/`
App source: `apps/readest-app/`

Build & deploy commands (used throughout this work):
```bash
cd apps/readest-app
pnpm build-web                      # builds Next.js static output to out/
# deploy to home server:
rsync -az --delete apps/readest-app/out/ jose@traijn.taila380c.ts.net:~/readest-web/
ssh jose@traijn.taila380c.ts.net "sudo rsync -a --delete ~/readest-web/ /var/www/readest/"
```
Live test URL: `http://traijn.taila380c.ts.net:3001`
Test book: `1984.epub` at `/Users/jose/Library/Mobile Documents/iCloud~com~apple~iBooks/Documents/1984.epub`

---

## Feature: RSVP (Speed Reading) with Chapter-Aware Word Counting

RSVP shows words one-at-a-time at a chosen WPM. The overlay shows:
- A **chapter label** (dropdown in the header) showing which chapter is active
- A **Chapter Progress** counter showing e.g. "1,234 / 8,500 words"

### The EPUB Structure Problem (1984 specifically)

Most EPUBs have one TOC chapter per spine file. **1984 does not.** In its EPUB:

- `OEBPS/16954_split_000.xhtml` is ONE spine file containing ALL of Part One
- Chapters 1–8 of Part One are just `id` anchors inside that single file:
  - `<div id="chapter-1">` → TOC entry `16954_split_000.xhtml#chapter-1`
  - `<div id="chapter-2">` → TOC entry `16954_split_000.xhtml#chapter-2`
  - etc.
- "Part One" is also a TOC entry, href = `16954_split_000.xhtml` (no fragment)

Before the fix, ALL chapters reported 30,983 words (the full spine section) because the code counted the entire section rather than the individual chapter's slice.

---

## What Was Built (Working Correctly)

### 1. Chapter-Aware Word Tagging — `RSVPController.ts`

During DOM extraction, each `RsvpWord` is tagged with the TOC chapter it belongs to:

```typescript
// types.ts
export interface RsvpWord {
  chapterHref?: string;  // e.g. "16954_split_000.xhtml#chapter-2"
  ...
}
```

In `RSVPController`:
- `setToc(toc)` — flattens the TOC tree and builds a Map: `fragment-id → full TOC href`
  - e.g. `"chapter-2" → "16954_split_000.xhtml#chapter-2"`
  - Clears word cache so next extraction re-tags words
- `extractWordsFromElement()` — walks the DOM; when it enters an element whose `id` matches a TOC fragment, it sets `currentChapterHref` for all following words
- `getChapterBounds(index)` — returns `{start, end}` of the contiguous run of words sharing the same `chapterHref` as `words[index]`
- `getChapterWordsAt(index)` — returns text[] for the chapter containing `words[index]`
- `getCurrentChapterWords()` — same, using `currentIndex`

This tagging is **working correctly**. Chapter word counts (via `getChapterBounds`) are accurate.

### 2. Chapter-End Auto-Pause

In `advanceToNextWord()`, when the next word has a different `chapterHref`, RSVP pauses and fires `rsvp-chapter-end`. The quiz button flashes. This works correctly.

### 3. Chapter Progress Display — `RSVPOverlay.tsx`

```typescript
const chapterProgress = useMemo(() => {
  if (state.words.length === 0) return { pos: 0, total: 0 };
  const { start, end } = controller.getChapterBounds(state.currentIndex);
  return { pos: state.currentIndex - start + 1, total: end - start + 1 };
}, [controller, state.currentIndex, state.words]);
```

The word count display ("1,234 / 8,500 words") uses this — it is **working correctly**, showing chapter-scoped counts.

---

## The Remaining Bug

**Symptom:** When using the chapter dropdown to jump to a different chapter within Part One, the **chapter label** in the header reverts to "Part One" instead of showing the selected chapter name. The word count updates correctly but the label is wrong.

### Root Cause Investigation

The chapter label is driven by `effectiveChapterHref` in `RSVPOverlay.tsx`. Two attempts were made to fix it:

#### Attempt 1: Derive label from current word's chapterHref

```typescript
// RSVPOverlay.tsx line ~270
const effectiveChapterHref =
  (state.words.length > 0 ? (state.words[state.currentIndex]?.chapterHref ?? null) : null) ??
  currentChapterHref;  // prop fallback
```

This should work once words are loaded at the correct index. But the label still showed "Part One."

#### Attempt 2: Seek to first word of selected chapter on load

In `RSVPController.loadNextPageContent()`, added `targetChapterHref?` param:
```typescript
loadNextPageContent(retryCount = 0, targetChapterHref?: string): void {
  ...
  let startIndex = 0;
  if (targetChapterHref) {
    const idx = words.findIndex((w) => w.chapterHref === targetChapterHref);
    if (idx >= 0) startIndex = idx;
  }
  this.state = { ...this.state, words, currentIndex: startIndex, ... };
```

And in `RSVPControl.tsx handleChapterSelect`:
```typescript
controller.loadNextPageContent(0, href);  // href = selected chapter TOC href
```

This also did not fix the label.

### Suspected Root Causes Still to Investigate

**Hypothesis A: `relocate` event may not fire for within-section navigation**

When the user selects Chapter 3, `view.goTo('16954_split_000.xhtml#chapter-3')` is called. Since the EPUB renderer (foliate-js) is already showing `16954_split_000.xhtml`, it might just scroll to the anchor without emitting a `relocate` event. If `relocate` never fires, `controller.loadNextPageContent(0, href)` never gets called at all, and RSVP stays paused wherever it was.

The `onRelocate` listener in `handleChapterSelect` (RSVPControl.tsx ~line 507) might simply never run for same-section chapter navigation.

**Hypothesis B: `detail.tocItem?.href` in relocate event contains wrong value**

When `relocate` does fire, `detail.tocItem?.href` might resolve to `"16954_split_000.xhtml"` (Part One, no fragment) because the renderer matches to the TOC item for the whole spine file, not the specific anchor. This would make `rsvpChapterHrefRef.current` wrong, but should not affect Attempt 1 since that reads from the word data directly.

**Hypothesis C: `view.goTo(href)` with a fragment-anchor navigates to a different spine section**

If 1984's chapter anchors are in a different spine file than expected (not `16954_split_000.xhtml`), the navigation would unload the current section and load a new one. The `relocate` event would fire with a new section, `loadNextPageContent` would run — but `targetChapterHref` might not match any word's `chapterHref` in the new section (since the new section would have different TOC hrefs).

**Hypothesis D: the `getCurrentChapterLabel()` fallback logic is matching wrong**

```typescript
// RSVPOverlay.tsx
const getCurrentChapterLabel = useCallback((): string => {
  if (!effectiveChapterHref) return _('Select Chapter');
  const exactMatch = flatChapters.find((c) => c.href === effectiveChapterHref);
  if (exactMatch) return exactMatch.label;
  // fallback: strip fragment and match by file
  const normalizedCurrent = effectiveChapterHref.split('#')[0]?.replace(/^\//, '') || '';
  const chapter = flatChapters.find((c) => {
    const normalizedHref = c.href.split('#')[0]?.replace(/^\//, '') || '';
    return normalizedHref === normalizedCurrent;
  });
  return chapter?.label || _('Select Chapter');
}, [_, effectiveChapterHref, flatChapters]);
```

If `effectiveChapterHref` correctly = `"16954_split_000.xhtml#chapter-3"`, then `exactMatch` should find "Chapter Three" in the TOC. BUT — the exact match depends on the TOC having an entry whose `href` is exactly `"16954_split_000.xhtml#chapter-3"`. If the TOC href uses a different path format (e.g., `/OEBPS/16954_split_000.xhtml#chapter-3` vs `16954_split_000.xhtml#chapter-3`), the exact match fails and the fallback kicks in, finding "Part One" by stripping the fragment.

**This is likely the actual bug.** Add a `console.log(effectiveChapterHref, flatChapters.map(c => c.href))` to confirm whether the hrefs match in format.

---

## Key Files

| File | Role |
|------|------|
| `apps/readest-app/src/services/rsvp/RSVPController.ts` | Word extraction, chapter tagging, playback |
| `apps/readest-app/src/services/rsvp/types.ts` | `RsvpWord` interface (has `chapterHref`) |
| `apps/readest-app/src/app/reader/components/rsvp/RSVPControl.tsx` | Orchestrator: creates controller, handles chapter select/page advance |
| `apps/readest-app/src/app/reader/components/rsvp/RSVPOverlay.tsx` | UI: chapter label, word count, playback controls |

### RSVPControl.tsx — Chapter Select Flow (lines ~502–525)

```typescript
const handleChapterSelect = useCallback(
  (href: string) => {
    const view = getView(bookKey);
    if (!view) return;

    const onRelocate = (e: Event) => {
      view.removeEventListener('relocate', onRelocate);
      const detail = (e as CustomEvent).detail as { section?: PageInfo; tocItem?: TOCItem };
      rsvpSectionRef.current = detail.section?.current ?? view.renderer.primaryIndex;
      rsvpChapterHrefRef.current = detail.tocItem?.href ?? null;
      const controller = controllerRef.current;
      if (controller) {
        const progress = getProgress(bookKey);
        if (progress?.location) controller.setCurrentCfi(progress.location);
        controller.loadNextPageContent(0, href);  // href = selected chapter TOC href
      }
    };
    view.addEventListener('relocate', onRelocate);
    view.goTo(href);
  },
  [bookKey, getProgress, getView],
);
```

Key concern: if `view.goTo(href)` is a same-section navigation (href points to an anchor in the already-displayed spine file), `relocate` may not fire, and `loadNextPageContent` never runs.

### RSVPOverlay.tsx — effectiveChapterHref derivation (line ~270)

```typescript
const effectiveChapterHref =
  (state.words.length > 0 ? (state.words[state.currentIndex]?.chapterHref ?? null) : null) ??
  currentChapterHref;
```

### RSVPOverlay.tsx — getCurrentChapterLabel (line ~357)

```typescript
const getCurrentChapterLabel = useCallback((): string => {
  if (!effectiveChapterHref) return _('Select Chapter');
  const exactMatch = flatChapters.find((c) => c.href === effectiveChapterHref);
  if (exactMatch) return exactMatch.label;
  const normalizedCurrent = effectiveChapterHref.split('#')[0]?.replace(/^\//, '') || '';
  const chapter = flatChapters.find((c) => {
    const normalizedHref = c.href.split('#')[0]?.replace(/^\//, '') || '';
    return normalizedHref === normalizedCurrent;
  });
  return chapter?.label || _('Select Chapter');
}, [_, effectiveChapterHref, flatChapters]);
```

---

## Recommended Debugging Steps

### Step 1: Add console.log to RSVPOverlay to see actual values

In `RSVPOverlay.tsx`, just before the `return (...)`:
```typescript
console.log('[RSVP] effectiveChapterHref:', effectiveChapterHref);
console.log('[RSVP] flatChapters hrefs:', flatChapters.map(c => c.href));
console.log('[RSVP] word[currentIndex].chapterHref:', state.words[state.currentIndex]?.chapterHref);
```

### Step 2: Verify relocate fires for same-section navigation

In `handleChapterSelect` (RSVPControl.tsx), log when `onRelocate` fires:
```typescript
const onRelocate = (e: Event) => {
  console.log('[RSVP] relocate fired for chapter select', (e as CustomEvent).detail);
  ...
```

If this never logs when selecting a chapter within Part One, the `relocate` event is not firing for fragment-only navigation. In that case, the fix is to call `controller.loadNextPageContent(0, href)` immediately after `view.goTo(href)` (without waiting for relocate) when the href is within the current spine section.

### Step 3: Check if href formats match

Compare `words[0].chapterHref` against `flatChapters[0].href` — do they use the same path prefix? (`16954_split_000.xhtml#...` vs `OEBPS/16954_split_000.xhtml#...` etc.)

---

## Fix Strategy (Most Likely)

Based on the analysis, the most likely fix requires **two things**:

**1. Call `loadNextPageContent` even if `relocate` doesn't fire (same-section navigation)**

```typescript
// RSVPControl.tsx handleChapterSelect
const handleChapterSelect = useCallback(
  (href: string) => {
    const view = getView(bookKey);
    if (!view) return;
    
    const controller = controllerRef.current;
    
    // Check if this is a same-section navigation (fragment anchor in current spine file)
    const currentSection = rsvpSectionRef.current;
    
    const onRelocate = (e: Event) => {
      view.removeEventListener('relocate', onRelocate);
      const detail = (e as CustomEvent).detail as { section?: PageInfo; tocItem?: TOCItem };
      rsvpSectionRef.current = detail.section?.current ?? view.renderer.primaryIndex;
      rsvpChapterHrefRef.current = href;  // use the href we navigated TO, not detail.tocItem
      if (controller) {
        const progress = getProgress(bookKey);
        if (progress?.location) controller.setCurrentCfi(progress.location);
        controller.loadNextPageContent(0, href);
      }
    };
    view.addEventListener('relocate', onRelocate);
    view.goTo(href);
    
    // If relocate doesn't fire within 300ms (same-section navigation),
    // load content directly:
    setTimeout(() => {
      view.removeEventListener('relocate', onRelocate);
      rsvpChapterHrefRef.current = href;
      if (controller) controller.loadNextPageContent(0, href);
    }, 300);
  },
  [bookKey, getProgress, getView],
);
```

**2. Normalize href format in getCurrentChapterLabel**

In `RSVPOverlay.tsx`, the exact match check should be case-insensitive and path-normalized:

```typescript
const exactMatch = flatChapters.find((c) => 
  c.href === effectiveChapterHref ||
  c.href.endsWith('#' + effectiveChapterHref.split('#')[1])  // match fragment regardless of path prefix
);
```

Or alternatively, in `RSVPController.setToc()`, store the full raw href in `chapterAnchors` AND also verify the href format matches what `flatChapters` uses before assuming exact match will work.

---

## What Was NOT Touched (Safe to Ignore)

- `src/services/comprehension/` — AI quiz generation (separate feature, working)
- `src/services/ai/` — Groq/OpenRouter providers (working)
- `src/app/reader/components/comprehension/` — quiz UI (working)
- `src-tauri/` — Rust backend (not involved)
- KOReader plugin at `/Users/jose/Developer/koreader-rsvp-plugin/` — separate Lua plugin for Kindle (working)

---

## Test Procedure

1. Open `http://traijn.taila380c.ts.net:3001` (hard refresh)
2. Open `1984.epub`
3. Start RSVP on any chapter of Part One
4. Open the chapter dropdown in the RSVP header
5. Select "Chapter Three" (or any other chapter within Part One)
6. **Expected**: header label shows "Chapter Three", word count resets to that chapter's count
7. **Actual**: header label reverts to "Part One"

The word count changing correctly but the label being wrong is the key distinguishing symptom.
