import { describe, expect, test } from 'vitest';
import { scoreResults } from '@/services/comprehension';
import type { ComprehensionResult } from '@/services/comprehension';

const mk = (isCorrect: boolean, override?: 'correct' | 'void'): ComprehensionResult => ({
  question: 'q',
  options: ['a', 'b', 'c', 'd'],
  correct: 0,
  chosen: isCorrect ? 0 : 1,
  explanation: '',
  isCorrect,
  override,
});

describe('scoreResults — manual score overrides', () => {
  test('counts raw correctness when there are no overrides', () => {
    expect(scoreResults([mk(true), mk(false), mk(true)])).toEqual({ score: 2, total: 3 });
  });

  test("override 'correct' overturns a wrong answer into the score", () => {
    expect(scoreResults([mk(true), mk(false, 'correct'), mk(true)])).toEqual({
      score: 3,
      total: 3,
    });
  });

  test("override 'void' drops the question from numerator and denominator", () => {
    expect(scoreResults([mk(true), mk(false, 'void'), mk(true)])).toEqual({ score: 2, total: 2 });
  });

  test('a voided correct answer is excluded too', () => {
    expect(scoreResults([mk(true, 'void'), mk(true)])).toEqual({ score: 1, total: 1 });
  });

  test('empty results score 0 / 0', () => {
    expect(scoreResults([])).toEqual({ score: 0, total: 0 });
  });
});
