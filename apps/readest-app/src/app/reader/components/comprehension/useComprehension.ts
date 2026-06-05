'use client';

import { useState, useCallback } from 'react';
import { generateQuestions, saveSession } from '@/services/comprehension';
import type { ComprehensionQuestion, ComprehensionResult } from '@/services/comprehension';
import type { AISettings } from '@/services/ai/types';

type Phase = 'idle' | 'offering' | 'generating' | 'question' | 'feedback' | 'results';

interface ComprehensionState {
  phase: Phase;
  questions: ComprehensionQuestion[];
  results: ComprehensionResult[];
  currentIndex: number;
  error: string | null;
}

const INITIAL_STATE: ComprehensionState = {
  phase: 'idle',
  questions: [],
  results: [],
  currentIndex: 0,
  error: null,
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
        const questions = await generateQuestions(
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
      return { ...s, phase: 'feedback', results: [...s.results, result] };
    });
  }, []);

  const next = useCallback(() => {
    setState((s) => {
      const nextIndex = s.currentIndex + 1;
      if (nextIndex >= s.questions.length) {
        // Save to localStorage before showing results
        const score = s.results.filter((r) => r.isCorrect).length;
        saveSession(bookHash, {
          bookHash,
          timestamp: Date.now(),
          score,
          total: s.results.length,
          results: s.results,
        });
        return { ...s, phase: 'results' };
      }
      return { ...s, phase: 'question', currentIndex: nextIndex };
    });
  }, [bookHash]);

  const more = useCallback(() => {
    setState((s) => ({ ...s, phase: 'generating' }));
    // Pull current results from state to pass as prior — use functional update
    setState((s) => {
      void startTest(s.results);
      return s;
    });
  }, [startTest]);

  const dismiss = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, offer, startTest, answer, next, more, dismiss };
}
