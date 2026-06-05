import { generateObject } from 'ai';
import { z } from 'zod';
import { getAIProvider } from '@/services/ai/providers';
import type { AISettings } from '@/services/ai/types';
import type { ComprehensionQuestion, ComprehensionSession } from './types';

const STORAGE_KEY_PREFIX = 'readest_comprehension_';
const MAX_HISTORY_PER_BOOK = 20;
const DEFAULT_QUESTION_COUNT = 3;
const DEFAULT_BUFFER_SIZE = 500;

const QuestionsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
      correct: z.number().int().min(0).max(3),
      explanation: z.string(),
    }),
  ),
});

function buildPrompt(
  words: string[],
  bookTitle: string,
  authorName: string,
  questionCount: number,
  avoidQuestions: string[],
): string {
  const passage = words.slice(-DEFAULT_BUFFER_SIZE).join(' ');
  const meta = authorName ? `"${bookTitle}" by ${authorName}` : `"${bookTitle}"`;

  const avoidBlock =
    avoidQuestions.length > 0
      ? `\n\nThese questions have already been asked — generate DIFFERENT questions covering other parts of the passage:\n${avoidQuestions.map((q) => `- ${q}`).join('\n')}`
      : '';

  return `You are a reading comprehension tutor. Generate exactly ${questionCount} multiple-choice questions based on the passage below.

Book: ${meta}

PASSAGE:
${passage}${avoidBlock}

Return a JSON object with a "questions" array of exactly ${questionCount} items. Each item must have:
- "question": string
- "options": array of exactly 4 strings (A, B, C, D)
- "correct": 0-indexed integer (0=A, 1=B, 2=C, 3=D)
- "explanation": one short sentence explaining the correct answer`;
}

export async function generateQuestions(
  words: string[],
  bookTitle: string,
  authorName: string,
  aiSettings: AISettings,
  questionCount = DEFAULT_QUESTION_COUNT,
  avoidQuestions: string[] = [],
): Promise<ComprehensionQuestion[]> {
  const provider = getAIProvider(aiSettings);
  const model = provider.getModel();
  const prompt = buildPrompt(words, bookTitle, authorName, questionCount, avoidQuestions);

  const { object } = await generateObject({
    model,
    schema: QuestionsSchema,
    prompt,
    temperature: 0.6,
    maxTokens: Math.max(1024, questionCount * 300),
  });

  return object.questions as ComprehensionQuestion[];
}

export function saveSession(bookHash: string, session: ComprehensionSession): void {
  try {
    const key = STORAGE_KEY_PREFIX + bookHash;
    const raw = localStorage.getItem(key);
    const history: ComprehensionSession[] = raw ? (JSON.parse(raw) as ComprehensionSession[]) : [];
    history.push(session);
    if (history.length > MAX_HISTORY_PER_BOOK) {
      history.splice(0, history.length - MAX_HISTORY_PER_BOOK);
    }
    localStorage.setItem(key, JSON.stringify(history));
  } catch {
    // localStorage unavailable (SSR or private mode) — silently skip
  }
}

export function loadHistory(bookHash: string): ComprehensionSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + bookHash);
    return raw ? (JSON.parse(raw) as ComprehensionSession[]) : [];
  } catch {
    return [];
  }
}
