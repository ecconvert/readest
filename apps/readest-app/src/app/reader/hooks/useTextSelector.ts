import { useEffect, useRef } from 'react';
import { BookNote } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getOSPlatform } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { isPointerInsideSelection, Point, TextSelection } from '@/utils/sel';
import { useInstantAnnotation } from './useInstantAnnotation';

// Instant-highlight quick action: on touch/pen a plain tap and a swipe are both
// page-turn gestures, so the highlight must not engage on pointer-down or it
// swallows the tap/swipe (the page jumps a page and input freezes — the Apple
// Pencil regression). It only engages after the finger/pen has held still on the
// text for this long; a tap releases first and a swipe moves first, so both fall
// through to pagination. Mouse input is not gated — a click vs. a press-drag is
// already unambiguous.
const INSTANT_HOLD_MS = 300;
// Movement past this many CSS px during the hold means the user is swiping, not
// settling in to highlight, so the pending engagement is cancelled.
const INSTANT_HOLD_MOVE_PX = 10;

export const useTextSelector = (
  bookKey: string,
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>,
  setEditingAnnotation: React.Dispatch<React.SetStateAction<BookNote | null>>,
  setExternalDragPoint: React.Dispatch<React.SetStateAction<Point | null>>,
  getAnnotationText: (range: Range) => Promise<string>,
  handleDismissPopup: () => void,
) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings, getProgress } = useReaderStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const osPlatform = getOSPlatform();

  const isPopuped = useRef(false);
  const isUpToPopup = useRef(false);
  const isTextSelected = useRef(false);
  const isTouchStarted = useRef(false);
  const selectionPosition = useRef<number | null>(null);
  const lastPointerType = useRef<string>('mouse');
  const isInstantAnnotating = useRef(false);
  const isInstantAnnotated = useRef(false);
  const annotationStartPoint = useRef<Point | null>(null);
  // The element instant annotating set `user-select: none` on, restored on
  // release (the pointerup target may differ once the pointer moved across nodes).
  const instantAnnotationTarget = useRef<HTMLElement | null>(null);
  // Pending instant-highlight still-hold (touch/pen): the timer engages the
  // highlight only after the press has stayed put for INSTANT_HOLD_MS. Armed in
  // handlePointerDown, dropped by a release, swipe, or cancel.
  const instantHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instantHoldTarget = useRef<HTMLElement | null>(null);
  const instantHoldStart = useRef<Point | null>(null);

  const {
    isInstantAnnotationEnabled,
    handleInstantAnnotationPointerDown,
    handleInstantAnnotationPointerMove,
    handleInstantAnnotationPointerCancel,
    handleInstantAnnotationPointerUp,
  } = useInstantAnnotation({
    bookKey,
    getAnnotationText,
    setSelection,
    setEditingAnnotation,
    setExternalDragPoint,
  });

  const isValidSelection = (sel: Selection) => {
    return sel && sel.toString().trim().length > 0 && sel.rangeCount > 0;
  };

  const makeSelection = async (sel: Selection, index: number, rebuildRange = false) => {
    isTextSelected.current = true;
    const range = sel.getRangeAt(0);
    if (rebuildRange) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const progress = getProgress(bookKey);
    setSelection({
      key: bookKey,
      text: await getAnnotationText(range),
      cfi: view?.getCFI(index, range),
      page: bookData?.isFixedLayout ? index + 1 : progress?.page || 0,
      range,
      index,
    });
  };

  const startInstantAnnotating = (target: HTMLElement, startPoint: Point) => {
    isInstantAnnotating.current = true;
    isInstantAnnotated.current = false;
    annotationStartPoint.current = startPoint;
    instantAnnotationTarget.current = target;
    if (view) view.renderer.scrollLocked = true;
    target.style.userSelect = 'none';
  };

  const stopInstantAnnotating = () => {
    isInstantAnnotating.current = false;
    isInstantAnnotated.current = false;
    annotationStartPoint.current = null;
    if (view) view.renderer.scrollLocked = false;
    if (instantAnnotationTarget.current) {
      instantAnnotationTarget.current.style.userSelect = '';
      instantAnnotationTarget.current = null;
    }
  };

  // Drop a pending still-hold without engaging (tap released early, finger/pen
  // swiped, or the gesture was cancelled).
  const cancelInstantHold = () => {
    if (instantHoldTimer.current) {
      clearTimeout(instantHoldTimer.current);
      instantHoldTimer.current = null;
    }
    instantHoldTarget.current = null;
    instantHoldStart.current = null;
  };

  // Begin the touch/pen still-hold: engage instant annotation only once the
  // press has stayed put on the text for INSTANT_HOLD_MS. preventDefault is NOT
  // called here, so a tap or swipe that bows out keeps its native page-turn.
  const armInstantHold = (ev: PointerEvent) => {
    instantHoldTarget.current = ev.target as HTMLElement;
    instantHoldStart.current = { x: ev.clientX, y: ev.clientY };
    if (instantHoldTimer.current) clearTimeout(instantHoldTimer.current);
    instantHoldTimer.current = setTimeout(() => {
      instantHoldTimer.current = null;
      const target = instantHoldTarget.current;
      const startPoint = instantHoldStart.current;
      cancelInstantHold();
      if (!target || !startPoint) return;
      startInstantAnnotating(target, startPoint);
    }, INSTANT_HOLD_MS);
  };

  // While a still-hold is pending, a move past the threshold means the user is
  // swiping to turn the page — cancel so the swipe isn't swallowed.
  const maybeCancelInstantHoldOnMove = (ev: PointerEvent) => {
    const start = instantHoldStart.current;
    if (!instantHoldTimer.current || !start) return;
    if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > INSTANT_HOLD_MOVE_PX) {
      cancelInstantHold();
      handleInstantAnnotationPointerCancel();
    }
  };

  const handlePointerDown = (doc: Document, index: number, ev: PointerEvent) => {
    lastPointerType.current = ev.pointerType;

    if (isInstantAnnotationEnabled()) {
      const eligible = handleInstantAnnotationPointerDown(doc, index, ev);
      if (!eligible) return;
      const isTouch = ev.pointerType === 'touch' || ev.pointerType === 'pen';
      if (isTouch) {
        // Touch/pen: gate behind a still hold so a tap or swipe still turns the page.
        armInstantHold(ev);
      } else {
        // Mouse: a press-drag is an unambiguous highlight intent; engage at once.
        ev.preventDefault();
        startInstantAnnotating(ev.target as HTMLElement, { x: ev.clientX, y: ev.clientY });
      }
    }
  };

  const handlePointerMove = (doc: Document, index: number, ev: PointerEvent) => {
    maybeCancelInstantHoldOnMove(ev);
    if (isInstantAnnotating.current) {
      // In scroll mode, detect gesture direction before committing to annotation.
      // Cancel if the gesture is along the scroll axis (vertical for normal, horizontal
      // for vertical writing mode) since the user likely intends to scroll.
      if (!isInstantAnnotated.current && annotationStartPoint.current) {
        const dx = Math.abs(ev.clientX - annotationStartPoint.current.x);
        const dy = Math.abs(ev.clientY - annotationStartPoint.current.y);
        const distance = Math.sqrt(dx * dx + dy * dy);
        const viewSettings = getViewSettings(bookKey);
        const isScrollGesture = viewSettings?.vertical ? dy < 3 * dx : dx < 3 * dy;
        if (distance >= 10 && isScrollGesture) {
          stopInstantAnnotating();
          handleInstantAnnotationPointerCancel();
          return;
        }
      }
      ev.preventDefault();
      isInstantAnnotated.current = handleInstantAnnotationPointerMove(doc, index, ev);
    }
  };

  const handlePointerCancel = (_doc: Document, _index: number, _ev: PointerEvent) => {
    // A pending still-hold that never engaged: drop it so a swipe-takeover (the
    // browser firing pointercancel when it starts scrolling) keeps its native
    // page-turn instead of being swallowed.
    cancelInstantHold();
    if (isInstantAnnotating.current) {
      stopInstantAnnotating();
      handleInstantAnnotationPointerCancel();
    }
  };

  const handlePointerUp = async (doc: Document, index: number, ev?: PointerEvent) => {
    // A tap (or a press shorter than the hold) that never engaged: drop the
    // pending still-hold so the tap falls through to a page turn.
    if (instantHoldTimer.current) cancelInstantHold();
    if (isInstantAnnotating.current && ev) {
      stopInstantAnnotating();
      const handled = await handleInstantAnnotationPointerUp(doc, index, ev);
      if (handled) {
        isTextSelected.current = true;
        setTimeout(() => {
          isTextSelected.current = false;
        }, 200);
        return;
      } else {
        // If instant annotation was not created, we let the event propagate
        // as an iframe click event which relies on a mousedown event
        (ev.target as Element)?.dispatchEvent(
          new MouseEvent('mousedown', {
            ...ev,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }

    // Available on iOS and Desktop, fired at touchend or mouseup
    // Note that on Android, we mock pointer events with native touch events
    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      const isPointerInside = ev && isPointerInsideSelection(sel, ev);

      // iOS no longer needs a special path: the native plugin
      // (ContextMenuSuppressor) suppresses the system selection menu, so
      // iOS selections go through the same path as desktop.
      if (isPointerInside) {
        isUpToPopup.current = true;
        makeSelection(sel, index, true);
      } else if (appService?.isAndroidApp) {
        isUpToPopup.current = false;
      }
    }
  };
  const handleTouchStart = () => {
    isTouchStarted.current = true;
  };
  const handleTouchMove = (ev: TouchEvent) => {
    if (isInstantAnnotating.current) {
      ev.preventDefault();
    }
  };
  const handleTouchEnd = () => {
    isTouchStarted.current = false;
  };
  const handleSelectionchange = (doc: Document, index: number) => {
    // Available on iOS, Android and Desktop, fired when the selection is changed.
    // On Android native app, this is the primary way to detect text selection.
    // On web with touch/pen in scroll mode, pointerup never fires (pointercancel
    // fires instead when browser takes over for scrolling), so we also handle
    // selectionchange for touch/pen input to pick up native text selections.
    const isAndroid = osPlatform === 'android' && appService?.isAndroidApp;
    const isTouchInput = lastPointerType.current === 'touch' || lastPointerType.current === 'pen';
    if (!isAndroid && !isTouchInput) return;

    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      if (selectionPosition.current === null) {
        // Save the absolute container scroll, not `renderer.start` — the
        // latter is section-relative, so restoring it as `containerPosition`
        // snaps multi-section paginated views back to the first rendered
        // section (#873-related Android regression).
        selectionPosition.current = view?.renderer?.containerPosition ?? null;
      }
      makeSelection(sel, index, false);
    } else {
      selectionPosition.current = null;
    }
  };
  const handleScroll = () => {
    // Prevent the container from scrolling when text is selected in paginated mode
    // FIXME: this is a workaround for issue #873
    // TODO: support text selection across pages
    if (osPlatform !== 'android' || !appService?.isAndroidApp) return;

    const viewSettings = getViewSettings(bookKey);
    if (viewSettings?.scrolled) return;

    if (isTextSelected.current && view?.renderer && selectionPosition.current !== null) {
      view.renderer.containerPosition = selectionPosition.current;
    }
  };

  const handleShowPopup = (showPopup: boolean) => {
    setTimeout(() => {
      if (showPopup && !isPopuped.current) {
        isUpToPopup.current = false;
      }
      isPopuped.current = showPopup;
    }, 500);
  };

  const handleUpToPopup = () => {
    isUpToPopup.current = true;
  };

  const handleContextmenu = (event: Event) => {
    if (appService?.isMobile) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    } else if (lastPointerType.current === 'touch' || lastPointerType.current === 'pen') {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    return;
  };

  useEffect(() => {
    const handleSingleClick = (): boolean => {
      if (isUpToPopup.current) {
        isUpToPopup.current = false;
        return true;
      }
      if (isTextSelected.current) {
        handleDismissPopup();
        isTextSelected.current = false;
        view?.deselect();
        return true;
      }
      if (isPopuped.current) {
        handleDismissPopup();
        return true;
      }
      return false;
    };

    eventDispatcher.onSync('iframe-single-click', handleSingleClick);
    return () => {
      eventDispatcher.offSync('iframe-single-click', handleSingleClick);
      if (instantHoldTimer.current) clearTimeout(instantHoldTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isTextSelected,
    isInstantAnnotating,
    handleScroll,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handlePointerDown,
    handlePointerMove,
    handlePointerCancel,
    handlePointerUp,
    handleSelectionchange,
    handleShowPopup,
    handleUpToPopup,
    handleContextmenu,
  };
};
