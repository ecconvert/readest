export interface ComprehensionQuestion {
  question: string;
  options: [string, string, string, string];
  correct: number; // 0-indexed
  explanation: string;
}

export interface ComprehensionResult {
  question: string;
  options: [string, string, string, string];
  correct: number;
  chosen: number;
  explanation: string;
  isCorrect: boolean;
  /**
   * Manual score override the reader applied after seeing the feedback (e.g.
   * the AI review found the question mis-keyed): `'correct'` counts it toward
   * the score regardless of `isCorrect`; `'void'` excludes it from the score
   * entirely (dropped from both numerator and denominator). Undefined = no
   * override, use `isCorrect` as graded.
   */
  override?: 'correct' | 'void';
}

export interface ComprehensionSession {
  bookHash: string;
  timestamp: number;
  score: number;
  total: number;
  results: ComprehensionResult[];
}
