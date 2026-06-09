'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import {
  RSVPController,
  RsvpStartChoice,
  RsvpStopPosition,
  buildRsvpExitConfigUpdate,
} from '@/services/rsvp';
import { eventDispatcher } from '@/utils/event';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { BookNote, PageInfo } from '@/types/book';
import { TOCItem } from '@/libs/document';
import { Insets } from '@/types/misc';
import type { FoliateView } from '@/types/view';
import { initJieba } from '@/utils/jieba';
import RSVPOverlay from './RSVPOverlay';
import RSVPStartDialog from './RSVPStartDialog';
import ComprehensionController from '../comprehension/ComprehensionController';

interface RSVPControlProps {
  bookKey: string;
  gridInsets: Insets;
}

// Helper to expand a range to include the full sentence
const expandRangeToSentence = (range: Range, doc: Document): Range => {
  const sentenceRange = doc.createRange();

  // Get the text content around the range
  const container = range.commonAncestorContainer;
  const parentElement =
    container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);

  if (!parentElement) return range;

  // Get the full text of the parent paragraph/element
  const fullText = parentElement.textContent || '';
  const rangeText = range.toString();

  // Find the position of our word in the parent text
  const wordStart = fullText.indexOf(rangeText);
  if (wordStart === -1) return range;

  // Find sentence boundaries (. ! ? or start/end of text)
  const sentenceEnders = /[.!?]/g;
  let sentenceStart = 0;
  let sentenceEnd = fullText.length;

  // Find the sentence start (look backwards for sentence ender)
  for (let i = wordStart - 1; i >= 0; i--) {
    if (sentenceEnders.test(fullText[i]!)) {
      sentenceStart = i + 1;
      // Skip any whitespace after the sentence ender
      while (sentenceStart < fullText.length && /\s/.test(fullText[sentenceStart]!)) {
        sentenceStart++;
      }
      break;
    }
  }

  // Find the sentence end (look forward for sentence ender)
  for (let i = wordStart; i < fullText.length; i++) {
    if (sentenceEnders.test(fullText[i]!)) {
      sentenceEnd = i + 1;
      break;
    }
  }

  // Create a tree walker to find the text nodes
  const walker = doc.createTreeWalker(parentElement, NodeFilter.SHOW_TEXT, null);
  let currentOffset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const nodeLength = node.textContent?.length || 0;

    if (!startNode && currentOffset + nodeLength > sentenceStart) {
      startNode = node;
      startOffset = sentenceStart - currentOffset;
    }

    if (currentOffset + nodeLength >= sentenceEnd) {
      endNode = node;
      endOffset = sentenceEnd - currentOffset;
      break;
    }

    currentOffset += nodeLength;
  }

  if (startNode && endNode) {
    try {
      sentenceRange.setStart(startNode, Math.max(0, startOffset));
      sentenceRange.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length || 0));
      return sentenceRange;
    } catch {
      return range;
    }
  }

  return range;
};

const findPositionAtPoint = (doc: Document, x: number, y: number) => {
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
};

const getViewportAnchorCfi = (view: FoliateView): string | null => {
  const rendererRect = view.renderer.getBoundingClientRect();
  const anchorX = rendererRect.left + rendererRect.width / 2;
  const anchorY = rendererRect.top + rendererRect.height * 0.4;
  const contents = view.renderer.getContents?.() ?? [];

  for (const content of contents) {
    const { doc, index } = content;
    if (!doc || index === undefined) continue;

    const frameRect = doc.defaultView?.frameElement?.getBoundingClientRect();
    if (!frameRect) continue;
    if (
      anchorX < frameRect.left ||
      anchorX > frameRect.right ||
      anchorY < frameRect.top ||
      anchorY > frameRect.bottom
    ) {
      continue;
    }

    const pos = findPositionAtPoint(doc, anchorX - frameRect.left, anchorY - frameRect.top);
    if (!pos) continue;

    try {
      const range = doc.createRange();
      range.setStart(pos.node, pos.offset);
      range.collapse(true);
      return view.getCFI(index, range);
    } catch {
      return null;
    }
  }

  return null;
};

const RSVPControl: React.FC<RSVPControlProps> = ({ bookKey, gridInsets }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getView, getProgress } = useReaderStore();
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore();
  const { themeCode } = useThemeStore();

  const [isActive, setIsActive] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [startChoice, setStartChoice] = useState<RsvpStartChoice | null>(null);
  // When RSVP pauses at a chapter boundary, flash the quiz button.
  const [quizFlash, setQuizFlash] = useState(false);
  // Section index we've already shown the chapter-end quiz prompt for, so a
  // second "play" past the boundary advances instead of re-prompting.
  const quizPromptSectionRef = useRef<number | null>(null);
  // Words of the chapter just finished at an intra-section chapter boundary,
  // so the quiz is scoped to that chapter rather than the whole spine section.
  const pendingQuizWordsRef = useRef<string[] | null>(null);
  // When a quiz is taken at a chapter/section boundary we keep RSVP alive and
  // resume playback once the quiz closes, instead of exiting speed-read mode.
  const resumeAfterQuizRef = useRef(false);
  // Stable mirror of `isActive` so the comprehension onClosed callback reads the
  // current value without a stale closure.
  const isActiveRef = useRef(false);
  const controllerRef = useRef<RSVPController | null>(null);
  const comprehensionOfferRef = useRef<((words: string[]) => void) | null>(null);
  const tempHighlightRef = useRef<BookNote | null>(null);
  // renderer.primaryIndex reverts after navigation (paginator #detectPrimaryView),
  // so track RSVP's actual section and chapter href in stable refs instead.
  const rsvpSectionRef = useRef<number>(-1);
  const rsvpChapterHrefRef = useRef<string | null>(null);

  // Keep the ref in sync so callbacks that fire outside React's render flow
  // (e.g. comprehension dialog close) see the latest active state.
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Helper to remove any existing RSVP highlight
  const removeRsvpHighlight = useCallback(() => {
    const view = getView(bookKey);
    if (tempHighlightRef.current && view) {
      try {
        view.addAnnotation(tempHighlightRef.current, true);
      } catch {
        // Ignore errors when removing
      }
    }
    tempHighlightRef.current = null;
  }, [bookKey, getView]);

  // Clean up controller and highlight on unmount
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        // Use stop() instead of shutdown() to preserve saved position across sessions
        // shutdown() clears localStorage which loses the user's reading progress
        controllerRef.current.stop();
        controllerRef.current = null;
      }
      // Remove any existing RSVP highlight when component unmounts
      removeRsvpHighlight();
      rsvpSectionRef.current = -1;
      rsvpChapterHrefRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for RSVP start events
  useEffect(() => {
    const handleRSVPStart = (event: CustomEvent) => {
      const { bookKey: rsvpBookKey, selectionText, autoStart } = event.detail;
      if (bookKey !== rsvpBookKey) return;
      handleStart(selectionText, autoStart);
    };

    const handleRSVPStop = (event: CustomEvent) => {
      const { bookKey: rsvpBookKey } = event.detail;
      if (bookKey !== rsvpBookKey) return;
      handleClose();
    };

    const handleComprehensionStart = (event: CustomEvent) => {
      const { bookKey: quizBookKey } = event.detail;
      if (bookKey !== quizBookKey) return;
      handleNormalReadingQuiz();
    };

    eventDispatcher.on('rsvp-start', handleRSVPStart);
    eventDispatcher.on('rsvp-stop', handleRSVPStop);
    eventDispatcher.on('comprehension-start', handleComprehensionStart);

    return () => {
      eventDispatcher.off('rsvp-start', handleRSVPStart);
      eventDispatcher.off('rsvp-stop', handleRSVPStop);
      eventDispatcher.off('comprehension-start', handleComprehensionStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  const handleStart = useCallback(
    (selectionText?: string, autoStart?: 'resume' | 'beginning') => {
      const view = getView(bookKey);
      const bookData = getBookData(bookKey);
      const progress = getProgress(bookKey);

      if (!view || !bookData || !bookData.book) {
        eventDispatcher.dispatch('toast', {
          message: _('Unable to start RSVP'),
          type: 'error',
        });
        return;
      }

      // Remove any existing RSVP highlight when starting new session
      removeRsvpHighlight();

      // Check if format is supported (not PDF)
      if (bookData.book.format === 'PDF') {
        eventDispatcher.dispatch('toast', {
          message: _('RSVP not supported for PDF'),
          type: 'warning',
        });
        return;
      }

      const primaryLanguage = bookData.book.primaryLanguage;

      // Create controller if not exists
      if (!controllerRef.current) {
        controllerRef.current = new RSVPController(view, bookKey, primaryLanguage);
        rsvpSectionRef.current = view.renderer.primaryIndex;
        rsvpChapterHrefRef.current = progress?.sectionHref ?? null;
      } else {
        controllerRef.current.setPrimaryLanguage(primaryLanguage);
      }

      const controller = controllerRef.current;
      // Provide the TOC so word extraction can split multi-chapter spine
      // sections (e.g. 1984's Parts) into real per-chapter ranges.
      controller.setToc(bookData.bookDoc?.toc);

      // For Chinese books, preload jieba-wasm so that the synchronous word
      // extractor can use it. Done before requestStart() so the loader has
      // the dialog's interaction time to fetch ~3.8MB of WASM.
      if (primaryLanguage?.toLowerCase().startsWith('zh')) {
        initJieba().catch((e) => {
          console.warn('Failed to initialize jieba-wasm; falling back to Intl.Segmenter:', e);
        });
      }

      // Seed localStorage from cloud-synced BookConfig so a fresh cross-device
      // rsvpPosition can override a stale local entry. seedPosition guards against
      // a corrupt synced pair (rsvpPosition.cfi in a different chapter than location).
      const config = getConfig(bookKey);
      const configPos = config?.rsvpPosition;
      if (configPos) {
        controller.seedPosition(configPos, config?.location ?? progress?.location ?? null);
      }

      // Set current CFI for position tracking
      if (progress?.location) {
        controller.setCurrentCfi(progress.location);
      }

      // Handle start choice event
      const handleStartChoice = (e: Event) => {
        const choice = (e as CustomEvent<RsvpStartChoice>).detail;
        setStartChoice(choice);

        // Deep-link / shortcut entry: skip the dialog and start immediately.
        if (autoStart === 'resume') {
          if (!choice.hasSavedPosition) {
            controller.startFromCurrentPosition();
            setIsActive(true);
            return;
          }

          const handleNavigateToResume = (event: Event) => {
            const { cfi } = (event as CustomEvent<{ cfi: string }>).detail;
            controller.removeEventListener('rsvp-navigate-to-resume', handleNavigateToResume);

            if (!view || !cfi) return;
            view.goTo(cfi);
            setTimeout(() => {
              const progress = getProgress(bookKey);
              if (progress?.location) {
                controller.setCurrentCfi(progress.location);
              }
              controller.start();
              setIsActive(true);
            }, 500);
          };

          controller.addEventListener('rsvp-navigate-to-resume', handleNavigateToResume);
          controller.startFromSavedPosition();
          if (controller.currentState.active) {
            setIsActive(true);
          }
          setTimeout(() => {
            controller.removeEventListener('rsvp-navigate-to-resume', handleNavigateToResume);
          }, 1000);
          return;
        }
        if (autoStart === 'beginning') {
          controller.startFromBeginning();
          setIsActive(true);
          return;
        }

        // If there's a saved position or selection, show dialog for user to choose
        if (choice.hasSavedPosition || choice.hasSelection) {
          setShowStartDialog(true);
        } else {
          // No saved position or selection - start from current page position
          controller.startFromCurrentPosition();
          setIsActive(true);
        }
      };

      controller.addEventListener('rsvp-start-choice', handleStartChoice);
      controller.requestStart(selectionText);

      // Clean up listener after handling
      setTimeout(() => {
        controller.removeEventListener('rsvp-start-choice', handleStartChoice);
      }, 100);
    },
    [_, bookKey, getBookData, getConfig, getProgress, getView, removeRsvpHighlight],
  );

  const handleStartDialogSelect = useCallback(
    (option: 'beginning' | 'saved' | 'current' | 'selection') => {
      setShowStartDialog(false);
      const controller = controllerRef.current;
      const view = getView(bookKey);
      if (!controller) return;

      // Handler for when we need to navigate to a different section for resume
      const handleNavigateToResume = (e: Event) => {
        const { cfi } = (e as CustomEvent<{ cfi: string }>).detail;
        controller.removeEventListener('rsvp-navigate-to-resume', handleNavigateToResume);

        if (view && cfi) {
          // Navigate to the saved position's section
          view.goTo(cfi);

          // Wait for navigation, then start RSVP — start() handles word extraction
          // and position recovery from storage directly, so loadNextPageContent()
          // must not be called here (it would clear the saved position first)
          setTimeout(() => {
            const progress = getProgress(bookKey);
            if (progress?.location) {
              controller.setCurrentCfi(progress.location);
            }
            controller.start();
            setIsActive(true);
          }, 500);
        }
      };

      switch (option) {
        case 'beginning':
          controller.startFromBeginning();
          setIsActive(true);
          break;
        case 'saved':
          // Listen for navigation event in case saved position is in different section
          controller.addEventListener('rsvp-navigate-to-resume', handleNavigateToResume);
          controller.startFromSavedPosition();
          // If startFromSavedPosition started directly (same section), setIsActive
          // If it emitted navigate event, the handler above will setIsActive after navigation
          if (!controller.currentState.active) {
            // Navigation event was emitted, don't set active yet
          } else {
            setIsActive(true);
          }
          // Clean up listener after a timeout if not used
          setTimeout(() => {
            controller.removeEventListener('rsvp-navigate-to-resume', handleNavigateToResume);
          }, 1000);
          break;
        case 'current': {
          // Refresh the CFI in case user scrolled since dialog opened
          const currentProgress = getProgress(bookKey);
          if (currentProgress?.location) {
            controller.setCurrentCfi(currentProgress.location);
          }
          controller.startFromCurrentPosition();
          setIsActive(true);
          break;
        }
        case 'selection':
          if (startChoice?.selectionText) {
            controller.startFromSelection(startChoice.selectionText);
          }
          setIsActive(true);
          break;
      }
    },
    [bookKey, getProgress, getView, startChoice],
  );

  const handleClose = useCallback(() => {
    const controller = controllerRef.current;
    const view = getView(bookKey);

    if (controller && view) {
      // Listen for the stop event to get the position
      const handleRsvpStop = (e: Event) => {
        const stopPosition = (e as CustomEvent<RsvpStopPosition | null>).detail;

        if (stopPosition && stopPosition.cfi) {
          try {
            // Navigate to the word's CFI position
            view.goTo(stopPosition.cfi);

            // Try to create a sentence highlight using the stored Range
            if (typeof stopPosition.docIndex === 'number' && stopPosition.range) {
              // Check if the original range is still valid
              let rangeIsValid = false;
              try {
                const rangeText = stopPosition.range.toString();
                rangeIsValid = rangeText === stopPosition.text;
              } catch {
                rangeIsValid = false;
              }

              if (rangeIsValid) {
                // Get the document from the renderer
                const contents = view.renderer.getContents?.();
                const content = contents?.find((c) => c.index === stopPosition.docIndex);
                const doc = content?.doc;

                if (doc) {
                  // Expand the range to include the full sentence
                  const sentenceRange = expandRangeToSentence(stopPosition.range, doc);
                  const sentenceCfi = view.getCFI(stopPosition.docIndex, sentenceRange);
                  const sentenceText = sentenceRange.toString();

                  if (sentenceCfi) {
                    // Remove any previous RSVP highlight
                    removeRsvpHighlight();

                    // Create a persistent highlight for the sentence
                    const highlight: BookNote = {
                      id: `rsvp-temp-${Date.now()}`,
                      type: 'annotation',
                      cfi: sentenceCfi,
                      text: sentenceText,
                      style: 'underline',
                      color: themeCode.primary,
                      note: '',
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    };

                    tempHighlightRef.current = highlight;
                    view.addAnnotation(highlight);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Failed to sync RSVP position:', err);
          }
        }
      };

      controller.addEventListener('rsvp-stop', handleRsvpStop);
      controller.stop();
      controller.removeEventListener('rsvp-stop', handleRsvpStop);

      // Offer comprehension test after RSVP stops — scope to the chapter being
      // read (correct for multi-chapter spine sections), or the chapter just
      // finished if we stopped at a chapter boundary.
      const words = pendingQuizWordsRef.current ?? controller.getCurrentChapterWords();
      pendingQuizWordsRef.current = null;
      comprehensionOfferRef.current?.(words);
    } else if (controller) {
      controller.stop();
    }

    // Persist RSVP position to BookConfig so it syncs to the cloud. Pin
    // `location` to the RSVP word's CFI so the next normal-mode load resumes
    // here instead of at a section boundary that a mid-RSVP relocate left
    // behind in the auto-saved config.
    const rsvpPosition = controller?.getStoredPosition();
    if (rsvpPosition) {
      const config = getConfig(bookKey);
      if (config) {
        const update = buildRsvpExitConfigUpdate(rsvpPosition);
        setConfig(bookKey, update);
        saveConfig(envConfig, bookKey, { ...config, ...update }, settings);
      }
    }

    setIsActive(false);
    setShowStartDialog(false);
    setQuizFlash(false);
    quizPromptSectionRef.current = null;
    pendingQuizWordsRef.current = null;
    // Manual exit (X button / rsvp-stop) must not auto-resume after the quiz.
    resumeAfterQuizRef.current = false;
  }, [
    bookKey,
    envConfig,
    getConfig,
    getView,
    removeRsvpHighlight,
    saveConfig,
    setConfig,
    settings,
    themeCode.primary,
  ]);

  const handleQuiz = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    setQuizFlash(false);
    // Prefer the chapter captured at a chapter-end boundary; otherwise scope
    // the quiz to the chapter currently being read (handles multi-chapter
    // spine sections), not the whole section.
    const words = pendingQuizWordsRef.current ?? controller.getCurrentChapterWords();
    pendingQuizWordsRef.current = null;
    // Stay in speed-read mode: keep the controller paused at the boundary and
    // resume playback once the quiz closes, instead of tearing RSVP down.
    resumeAfterQuizRef.current = true;
    controller.pause();
    comprehensionOfferRef.current?.(words);
  }, []);

  const handleNormalReadingQuiz = useCallback(() => {
    const view = getView(bookKey);
    const bookData = getBookData(bookKey);
    const progress = getProgress(bookKey);

    if (!view || !bookData?.book) {
      eventDispatcher.dispatch('toast', {
        message: _('Unable to start comprehension quiz'),
        type: 'error',
      });
      return;
    }

    if (!settings.aiSettings?.enabled) {
      eventDispatcher.dispatch('toast', {
        message: _('AI is not enabled'),
        type: 'warning',
      });
      return;
    }

    if (bookData.book.format === 'PDF' || bookData.isFixedLayout) {
      eventDispatcher.dispatch('toast', {
        message: _('Comprehension quiz is not supported for this book'),
        type: 'warning',
      });
      return;
    }

    const primaryLanguage = bookData.book.primaryLanguage;
    if (primaryLanguage?.toLowerCase().startsWith('zh')) {
      initJieba().catch((e) => {
        console.warn('Failed to initialize jieba-wasm; falling back to Intl.Segmenter:', e);
      });
    }

    if (!controllerRef.current) {
      controllerRef.current = new RSVPController(view, bookKey, primaryLanguage);
    } else {
      controllerRef.current.setPrimaryLanguage(primaryLanguage);
    }

    const controller = controllerRef.current;
    controller.setToc(bookData.bookDoc?.toc);

    const anchorCfi = getViewportAnchorCfi(view) ?? progress?.location ?? null;
    if (anchorCfi) controller.setCurrentCfi(anchorCfi);

    const words = controller.getCurrentChapterWordsAtCfi(anchorCfi);
    if (words.length < 30) {
      eventDispatcher.dispatch('toast', {
        message: _('Not enough chapter text for a quiz yet'),
        type: 'warning',
      });
      return;
    }

    comprehensionOfferRef.current?.(words);
  }, [_, bookKey, getBookData, getProgress, getView, settings.aiSettings]);

  // Fired by the controller when RSVP finishes a chapter inside a spine
  // section (e.g. between 1984's Part-internal chapters). The controller has
  // already paused; capture the finished chapter for the quiz and flash.
  const handleChapterEnd = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const aiEnabled = settings.aiSettings?.enabled;
    const pauseAtChapterEnd = settings.aiSettings?.comprehension?.pauseAtChapterEnd ?? true;
    if (!aiEnabled || !pauseAtChapterEnd) {
      // Feature off: resume into the next chapter without interrupting.
      controller.resume();
      return;
    }
    // currentIndex now sits on the first word of the next chapter, so the
    // chapter we just finished ends at currentIndex - 1.
    const finishedIndex = Math.max(0, controller.currentState.currentIndex - 1);
    pendingQuizWordsRef.current = controller.getChapterWordsAt(finishedIndex);
    setQuizFlash(true);
  }, [settings]);

  const handleChapterSelect = useCallback(
    (href: string) => {
      const view = getView(bookKey);
      if (!view) return;

      let handled = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

      const loadSelectedChapter = () => {
        rsvpChapterHrefRef.current = href;
        const controller = controllerRef.current;
        if (controller) {
          const progress = getProgress(bookKey);
          if (progress?.location) {
            controller.setCurrentCfi(progress.location);
          }
          controller.loadNextPageContent(0, href);
        }
      };

      const onRelocate = (e: Event) => {
        if (handled) return;
        handled = true;
        view.removeEventListener('relocate', onRelocate);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        const detail = (e as CustomEvent).detail as { section?: PageInfo; tocItem?: TOCItem };
        rsvpSectionRef.current = detail.section?.current ?? view.renderer.primaryIndex;
        loadSelectedChapter();
      };

      view.addEventListener('relocate', onRelocate);
      view.goTo(href);

      // Anchor navigation within the current spine file may scroll without a
      // relocate event, so fall back to reloading the already-rendered content
      // and seeking to the selected chapter's first tagged word.
      fallbackTimer = setTimeout(() => {
        if (handled) return;
        handled = true;
        view.removeEventListener('relocate', onRelocate);
        rsvpSectionRef.current = view.renderer.primaryIndex;
        loadSelectedChapter();
      }, 300);
    },
    [bookKey, getProgress, getView],
  );

  const handleRequestNextPage = useCallback(async () => {
    const view = getView(bookKey);
    if (!view) return;

    removeRsvpHighlight();

    if (view.renderer.atEnd) {
      controllerRef.current?.pause();
      return;
    }

    // Chapter-end quiz prompt: pause and flash the quiz button instead of
    // advancing into the next chapter. Skip if we've already prompted for
    // this section (a second play means "continue to the next chapter").
    const aiEnabled = settings.aiSettings?.enabled;
    const pauseAtChapterEnd = settings.aiSettings?.comprehension?.pauseAtChapterEnd ?? true;
    const controller = controllerRef.current;
    const wordsRead = controller?.currentState.words?.length ?? 0;
    const currentSection = rsvpSectionRef.current;
    if (
      aiEnabled &&
      pauseAtChapterEnd &&
      controller &&
      wordsRead >= 30 &&
      quizPromptSectionRef.current !== currentSection
    ) {
      quizPromptSectionRef.current = currentSection;
      controller.pause();
      setQuizFlash(true);
      return;
    }
    setQuizFlash(false);

    const indexBefore =
      rsvpSectionRef.current >= 0 ? rsvpSectionRef.current : view.renderer.primaryIndex;

    let cleanup: ReturnType<typeof setTimeout> | null = null;

    const onRelocate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { section?: PageInfo; tocItem?: TOCItem };
      const newIndex = detail.section?.current ?? view.renderer.primaryIndex;

      if (newIndex === indexBefore) return; // revert relocate — keep waiting

      view.removeEventListener('relocate', onRelocate);
      if (cleanup) clearTimeout(cleanup);

      const controller = controllerRef.current;
      if (!controller) return;

      rsvpSectionRef.current = newIndex;
      rsvpChapterHrefRef.current = detail.tocItem?.href ?? null;

      const progress = getProgress(bookKey);
      if (progress?.location) {
        controller.setCurrentCfi(progress.location);
      }
      controller.loadNextPageContent();
    };

    view.addEventListener('relocate', onRelocate);
    cleanup = setTimeout(() => view.removeEventListener('relocate', onRelocate), 5000);
    // Navigate directly to rsvpSectionRef.current + 1 rather than calling nextSection(),
    // which uses renderer.primaryIndex internally. primaryIndex reverts to the previous
    // section after navigation (#detectPrimaryView), so nextSection() would re-navigate
    // to the already-current section and the onRelocate filter would discard the event.
    await view.renderer.goTo({ index: rsvpSectionRef.current + 1 });
  }, [bookKey, getProgress, getView, removeRsvpHighlight, settings]);

  // Get current chapter info
  const progress = getProgress(bookKey);
  const bookData = getBookData(bookKey);
  const chapters = bookData?.bookDoc?.toc || [];
  const currentChapterHref = rsvpChapterHrefRef.current ?? progress?.sectionHref ?? null;

  // Use portal to render overlay at body level to avoid stacking context issues
  const portalContainer = typeof document !== 'undefined' ? document.body : null;

  const book = bookData?.book;

  return (
    <>
      {/* Comprehension controller - rendered outside portal so it sits above everything */}
      {book && (
        <ComprehensionController
          bookHash={book.hash}
          bookTitle={book.title}
          authorName={book.author}
          aiSettings={settings.aiSettings}
          onRegisterOffer={(fn) => {
            comprehensionOfferRef.current = fn;
          }}
          onClosed={() => {
            // Resume speed-reading after a boundary quiz closes, so the user
            // stays in RSVP mode instead of being dropped back to the reader.
            if (resumeAfterQuizRef.current && isActiveRef.current) {
              resumeAfterQuizRef.current = false;
              controllerRef.current?.resume();
            }
          }}
        />
      )}

      {/* Start dialog - render via portal */}
      {showStartDialog &&
        startChoice &&
        portalContainer &&
        createPortal(
          <RSVPStartDialog
            startChoice={startChoice}
            onSelect={handleStartDialogSelect}
            onClose={() => setShowStartDialog(false)}
          />,
          portalContainer,
        )}

      {/* RSVP Overlay - render via portal */}
      {isActive &&
        controllerRef.current &&
        portalContainer &&
        createPortal(
          <RSVPOverlay
            gridInsets={gridInsets}
            controller={controllerRef.current}
            chapters={chapters}
            currentChapterHref={currentChapterHref}
            onClose={handleClose}
            onQuiz={handleQuiz}
            quizFlash={quizFlash}
            onChapterEnd={handleChapterEnd}
            onChapterSelect={handleChapterSelect}
            onRequestNextPage={handleRequestNextPage}
          />,
          portalContainer,
        )}
    </>
  );
};

export default RSVPControl;
