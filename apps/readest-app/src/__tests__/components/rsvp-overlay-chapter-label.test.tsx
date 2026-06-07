'use client';

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import RSVPOverlay from '@/app/reader/components/rsvp/RSVPOverlay';
import { RSVPController, RsvpState } from '@/services/rsvp';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeCode: { bg: '#fff', fg: '#111', primary: '#2563eb' },
    isDarkMode: false,
  }),
}));

const state: RsvpState = {
  active: true,
  playing: false,
  words: [
    {
      text: 'Hello',
      orpIndex: 1,
      pauseMultiplier: 1,
      chapterHref: '16954_split_000.xhtml#chapter-3',
    },
  ],
  currentIndex: 0,
  currentPartIndex: 0,
  wpm: 300,
  punctuationPauseMs: 100,
  splitHyphens: false,
  cjkCharMode: false,
  hasCJK: false,
  progress: 0,
};

const makeController = (): RSVPController =>
  ({
    currentState: state,
    currentCountdown: null,
    currentDisplayWord: state.words[0],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getChapterBounds: vi.fn(() => ({ start: 0, end: 0 })),
    getWpmOptions: vi.fn(() => [300]),
    getPunctuationPauseOptions: vi.fn(() => [100]),
    pause: vi.fn(),
    togglePlayPause: vi.fn(),
    skipBackward: vi.fn(),
    skipForward: vi.fn(),
    decreaseSpeed: vi.fn(),
    increaseSpeed: vi.fn(),
    seekToIndex: vi.fn(),
    seekToPosition: vi.fn(),
    resume: vi.fn(),
    setWpm: vi.fn(),
    setPunctuationPause: vi.fn(),
    setSplitHyphens: vi.fn(),
    setCjkCharMode: vi.fn(),
  }) as unknown as RSVPController;

describe('RSVPOverlay chapter label', () => {
  afterEach(() => {
    cleanup();
  });

  test('matches chapter fragments across path-prefix differences before falling back to section label', () => {
    render(
      <RSVPOverlay
        gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        controller={makeController()}
        chapters={[
          {
            id: 1,
            index: 0,
            label: 'Part One',
            href: 'OEBPS/16954_split_000.xhtml',
            subitems: [
              {
                id: 2,
                index: 0,
                label: 'Chapter Three',
                href: 'OEBPS/16954_split_000.xhtml#chapter-3',
              },
            ],
          },
        ]}
        currentChapterHref='OEBPS/16954_split_000.xhtml'
        onClose={vi.fn()}
        onQuiz={vi.fn()}
        onChapterSelect={vi.fn()}
        onRequestNextPage={vi.fn()}
      />,
    );

    expect(screen.getByText('Chapter Three')).toBeTruthy();
  });
});
