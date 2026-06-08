'use client';

import { useState, useCallback } from 'react';
import {
  generateQuestions,
  reviewQuestion,
  saveSession,
  scoreResults,
} from '@/services/comprehension';
import type { ComprehensionQuestion, ComprehensionResult } from '@/services/comprehension';
import type { AISettings } from '@/services/ai/types';

type Phase = 'idle' | 'offering' | 'generating' | 'question' | 'feedback' | 'results';

interface ComprehensionState {
  phase: Phase;
  questions: ComprehensionQuestion[];
  results: ComprehensionResult[];
  currentIndex: number;
  error: string | null;
  lastPrompt: string | null;
  reviewText: string | null;
  reviewLoading: boolean;
}

const INITIAL_STATE: ComprehensionState = {
  phase: 'idle',
  questions: [],
  results: [],
  currentIndex: 0,
  error: null,
  lastPrompt: null,
  reviewText: null,
  reviewLoading: false,
};

export function useComprehension(
  bookHash: string,
  bookTitle: string,
  authorName: string,
  aiSettings: AISettings | null,
) {
  const [state, setState] = useState<ComprehensionState>(INITIAL_STATE);
  // Stored so "more questions" can regenerate from the same session words
  const [sessionWords, setSessionWords] = useState<string[]>([]);

  const offer = useCallback(
    (words: string[]) => {
      if (words.length < 30 || !aiSettings?.enabled) return;
      setSessionWords(words);
      setState({ ...INITIAL_STATE, phase: 'offering' });
    },
    [aiSettings],
  );

  const startTest = useCallback(
    async (priorResults: ComprehensionResult[] = []) => {
      if (!aiSettings) return;
      setState((s) => ({ ...s, phase: 'generating', error: null }));
      try {
        const avoid = priorResults.map((r) => r.question);
        const { questions, prompt } = await generateQuestions(
          sessionWords,
          bookTitle,
          authorName,
          aiSettings,
          undefined,
          avoid,
        );
        setState((s) => ({
          ...s,
          phase: 'question',
          questions,
          results: priorResults,
          currentIndex: 0,
          lastPrompt: prompt,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          phase: 'idle',
          error: err instanceof Error ? err.message : 'Failed to generate questions',
        }));
      }
    },
    [aiSettings, sessionWords, bookTitle, authorName],
  );

  const answer = useCallback((chosenIndex: number) => {
    setState((s) => {
      const q = s.questions[s.currentIndex];
      if (!q) return s;
      const result: ComprehensionResult = {
        question: q.question,
        options: q.options,
        correct: q.correct,
        chosen: chosenIndex,
        explanation: q.explanation,
        isCorrect: chosenIndex === q.correct,
      };
      return {
        ...s,
        phase: 'feedback',
        results: [...s.results, result],
        reviewText: null,
        reviewLoading: false,
      };
    });
  }, []);

  const next = useCallback(() => {
    setState((s) => {
      const nextIndex = s.currentIndex + 1;
      if (nextIndex >= s.questions.length) {
        // Save to localStorage before showing results, honoring any manual
        // score overrides the reader applied on the feedback screen.
        const { score, total } = scoreResults(s.results);
        saveSession(bookHash, {
          bookHash,
          timestamp: Date.now(),
          score,
          total,
          results: s.results,
        });
        return { ...s, phase: 'results', reviewText: null, reviewLoading: false };
      }
      return {
        ...s,
        phase: 'question',
        currentIndex: nextIndex,
        reviewText: null,
        reviewLoading: false,
      };
    });
  }, [bookHash]);

  // Ask the model to re-check the question the reader just got wrong, in case
  // it was mis-keyed or ambiguous.
  const review = useCallback(
    async (result: ComprehensionResult) => {
      if (!aiSettings) return;
      setState((s) => ({ ...s, reviewLoading: true, reviewText: null }));
      try {
        const text = await reviewQuestion(result, sessionWords, bookTitle, authorName, aiSettings);
        setState((s) => ({ ...s, reviewLoading: false, reviewText: text }));
      } catch (err) {
        setState((s) => ({
          ...s,
          reviewLoading: false,
          reviewText: err instanceof Error ? err.message : 'Could not review this question',
        }));
      }
    },
    [aiSettings, sessionWords, bookTitle, authorName],
  );

  // Manually overturn or void the question currently shown on the feedback
  // screen (it's always the most recent result). Pass null to undo.
  const overrideResult = useCallback((override: 'correct' | 'void' | null) => {
    setState((s) => {
      if (s.results.length === 0) return s;
      const results = s.results.slice();
      const last = results[results.length - 1]!;
      results[results.length - 1] = { ...last, override: override ?? undefined };
      return { ...s, results };
    });
  }, []);

  const more = useCallback(() => {
    setState((s) => ({ ...s, phase: 'generating', reviewText: null, reviewLoading: false }));
    // Pull current results from state to pass as prior — use functional update
    setState((s) => {
      void startTest(s.results);
      return s;
    });
  }, [startTest]);

  const dismiss = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, offer, startTest, answer, next, more, review, overrideResult, dismiss };
}
