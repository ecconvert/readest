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
}

export interface ComprehensionSession {
  bookHash: string;
  timestamp: number;
  score: number;
  total: number;
  results: ComprehensionResult[];
}
