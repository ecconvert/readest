export interface RsvpWord {
  text: string;
  orpIndex: number;
  pauseMultiplier: number;
  range?: Range;
  docIndex?: number;
  cfi?: string; // Canonical Fragment Identifier for precise position tracking
  // TOC href of the chapter this word belongs to. Lets a single spine section
  // that contains several TOC chapters (e.g. 1984's Parts, where Chapter 1/2/3
  // are #anchors inside one file) be split into real per-chapter ranges for
  // word counts and chapter-end boundaries. undefined = no anchor seen yet.
  chapterHref?: string;
  // True when this word is the first word after a block-level boundary (P, heading,
  // LI, BLOCKQUOTE, PRE, BR, etc.). Used by the context panel to render line breaks
  // so poems and blockquotes show their original visual structure.
  isNewBlock?: boolean;
}

export interface RsvpState {
  active: boolean;
  playing: boolean;
  words: RsvpWord[];
  currentIndex: number;
  currentPartIndex: number;
  wpm: number;
  punctuationPauseMs: number;
  splitHyphens: boolean;
  cjkCharMode: boolean;
  hasCJK: boolean;
  progress: number;
}

export interface RsvpPosition {
  cfi: string;
  wordText: string;
}

export interface RsvpStopPosition {
  wordIndex: number;
  totalWords: number;
  text: string;
  range?: Range;
  docIndex?: number;
  cfi?: string; // Canonical Fragment Identifier for the stop position
}

export interface RsvpStartChoice {
  hasSavedPosition: boolean;
  hasSelection: boolean;
  selectionText?: string;
}
