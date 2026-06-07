import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { GROQ_BASE_URL, GROQ_DEFAULT_MODEL } from '../constants';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

/**
 * Groq provider. Groq exposes an OpenAI-compatible API at a fixed endpoint
 * (api.groq.com), so this wraps `@ai-sdk/openai-compatible` with the base URL
 * hardcoded and reads its own `groqApiKey` / `groqModel` settings. Distinct
 * from `OpenRouterProvider` so users can keep Groq and OpenRouter configured
 * side by side and switch the active provider without retyping keys.
 *
 * Note: Groq does not offer an embeddings endpoint, so RAG/embedding features
 * are unsupported here — `getEmbeddingModel` throws if invoked.
 */
export class GroqProvider implements AIProvider {
  id: AIProviderName = 'groq';
  name = 'Groq';
  requiresAuth = true;

  private settings: AISettings;
  private client: ReturnType<typeof createOpenAICompatible>;
  private apiKey: string;
  private httpFetch: typeof fetch;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.groqApiKey) {
      throw new Error('Groq API key required');
    }
    this.apiKey = settings.groqApiKey;
    this.httpFetch = getAIFetch();
    this.client = createOpenAICompatible({
      name: 'groq',
      baseURL: GROQ_BASE_URL,
      apiKey: this.apiKey,
      fetch: this.httpFetch,
    });
    aiLogger.provider.init('groq', settings.groqModel || GROQ_DEFAULT_MODEL);
  }

  getModel(): LanguageModel {
    const modelId = this.settings.groqModel || GROQ_DEFAULT_MODEL;
    return this.client.chatModel(modelId);
  }

  getEmbeddingModel(): EmbeddingModel {
    throw new Error('Groq does not provide an embeddings endpoint');
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await this.httpFetch(`${GROQ_BASE_URL}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      aiLogger.provider.init('groq', 'healthCheck success');
      return true;
    } catch (e) {
      aiLogger.provider.error('groq', `healthCheck failed: ${(e as Error).message}`);
      return false;
    }
  }
}
