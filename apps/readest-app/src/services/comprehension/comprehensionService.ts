import { generateText } from 'ai';
import { z } from 'zod';
import { getAIProvider } from '@/services/ai/providers';
import type { AISettings } from '@/services/ai/types';
import type { ComprehensionQuestion, ComprehensionSession } from './types';

const STORAGE_KEY_PREFIX = 'readest_comprehension_';
const MAX_HISTORY_PER_BOOK = 20;
const DEFAULT_QUESTION_COUNT = 3;
const DEFAULT_BUFFER_SIZE = 50000;
const MAX_QUESTION_COUNT = 20;

function calcQuestionCount(wordCount: number, aiSettings: AISettings): number {
  const cfg = aiSettings.comprehension;
  const base = cfg?.baseQuestions ?? DEFAULT_QUESTION_COUNT;
  const wordsPerExtra = cfg?.wordsPerExtraQuestion ?? 100;
  const extraPerInterval = cfg?.extraQuestionsPerInterval ?? 1;
  const extra = Math.floor(wordCount / wordsPerExtra) * extraPerInterval;
  return Math.min(base + extra, MAX_QUESTION_COUNT);
}

const QuestionSchema = z.object({
  question: z.string(),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  correct: z.number().int().min(0).max(3),
  explanation: z.string(),
});

// Tolerant parsing of an LLM response into the question array. Mirrors the
// proven KOReader Lua approach: strip reasoning/markdown wrappers, locate the
// JSON, accept either a bare array or a { questions: [...] } object, and
// coerce common model quirks (1-indexed answers, out-of-range correct).
function parseQuestions(raw: string): ComprehensionQuestion[] {
  let clean = raw
    // drop reasoning blocks some models emit before the JSON
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // strip ```json ... ``` fences
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  let decoded: unknown;
  try {
    decoded = JSON.parse(clean);
  } catch {
    // Fallback: locate the first JSON object/array anywhere in the text
    const start = clean.search(/[[{]/);
    if (start >= 0) {
      clean = clean.slice(start);
      // trim trailing prose after the last closing bracket/brace
      const lastClose = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
      if (lastClose >= 0) clean = clean.slice(0, lastClose + 1);
    }
    decoded = JSON.parse(clean); // throws if still unparseable
  }

  const arr = Array.isArray(decoded)
    ? decoded
    : ((decoded as { questions?: unknown }).questions ?? null);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('No questions array found in response');
  }

  return arr.map((q) => {
    const item = q as { correct?: unknown };
    // Coerce 1-indexed (1-4) → 0-indexed; clamp anything else into range.
    let correct = Math.floor(Number(item.correct));
    if (!Number.isFinite(correct) || correct < 0 || correct > 3) {
      correct = correct >= 1 && correct <= 4 ? correct - 1 : 0;
    }
    return QuestionSchema.parse({ ...(q as object), correct });
  });
}

function buildPrompt(
  words: string[],
  bookTitle: string,
  authorName: string,
  questionCount: number,
  avoidQuestions: string[],
): string {
  const passage = words.join(' ');
  const meta = authorName ? `"${bookTitle}" by ${authorName}` : `"${bookTitle}"`;

  const avoidBlock =
    avoidQuestions.length > 0
      ? `\n\nThese questions have already been asked — generate DIFFERENT questions covering other parts of the passage:\n${avoidQuestions.map((q) => `- ${q}`).join('\n')}`
      : '';

  return `You are a reading comprehension tutor. Generate exactly ${questionCount} multiple-choice questions based STRICTLY on the passage below.

Book: ${meta}

IMPORTANT: Only use information explicitly stated in the passage. Do NOT use any outside knowledge about this book beyond what appears in the passage text.

PASSAGE:
${passage}${avoidBlock}

Return a JSON object with a "questions" array of exactly ${questionCount} items. Each item must have:
- "question": string (must be answerable using only the passage above)
- "options": array of exactly 4 strings (A, B, C, D)
- "correct": 0-indexed integer (0=A, 1=B, 2=C, 3=D)
- "explanation": one short sentence citing where in the passage the answer appears`;
}

export async function generateQuestions(
  words: string[],
  bookTitle: string,
  authorName: string,
  aiSettings: AISettings,
  questionCount?: number,
  avoidQuestions: string[] = [],
): Promise<{ questions: ComprehensionQuestion[]; prompt: string }> {
  const passage = words.slice(-DEFAULT_BUFFER_SIZE);
  const count = questionCount ?? calcQuestionCount(passage.length, aiSettings);
  const provider = getAIProvider(aiSettings);
  const model = provider.getModel();
  const prompt = buildPrompt(passage, bookTitle, authorName, count, avoidQuestions);
  const maxOutputTokens = Math.max(1024, count * 300);

  // generateText + tolerant parse (instead of generateObject) so models that
  // wrap JSON in reasoning/markdown — common with free + reasoning models —
  // still work. Retry once before surfacing the error.
  let lastError: unknown;
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await generateText({ model, prompt, temperature: 0.6, maxOutputTokens });
    lastRaw = text;
    try {
      return { questions: parseQuestions(text), prompt };
    } catch (err) {
      lastError = err;
    }
  }
  const snippet = lastRaw.slice(0, 200).replace(/\s+/g, ' ').trim();
  throw new Error(
    `Could not parse model response: ${lastError instanceof Error ? lastError.message : 'unknown'}` +
      (snippet ? ` — got: "${snippet}…"` : ''),
  );
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
