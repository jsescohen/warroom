import { config, type ProviderId } from '../config';
import { postJson, type CompletionRequest, type LLMProvider } from './types';

/** Ollama (local). https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion */
class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  constructor(readonly model: string, private baseUrl: string, private numCtx: number) {}
  async complete(r: CompletionRequest) {
    const data = await postJson(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      model: this.model,
      stream: false,
      format: r.json ? 'json' : undefined,
      messages: [{ role: 'system', content: r.system }, ...r.messages],
      options: { temperature: r.temperature, num_predict: r.maxTokens, num_ctx: this.numCtx },
    }, {}, r.signal);
    return String(data?.message?.content ?? '');
  }
}

/** Google Gemini (generateContent REST API). */
class GeminiProvider implements LLMProvider {
  readonly id = 'gemini';
  constructor(readonly model: string, private apiKey: string) {}
  async complete(r: CompletionRequest) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const data = await postJson(url, {
      systemInstruction: { parts: [{ text: r.system }] },
      contents: r.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: r.temperature,
        // thinking models spend output tokens on reasoning; leave headroom
        maxOutputTokens: Math.max(r.maxTokens * 4, 1024),
        responseMimeType: r.json ? 'application/json' : undefined,
      },
    }, { 'x-goog-api-key': this.apiKey }, r.signal);
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p: any) => p.text ?? '').join('');
  }
}

/** OpenAI-compatible chat completions (Groq, OpenRouter). */
class OpenAICompatProvider implements LLMProvider {
  constructor(
    readonly id: string,
    readonly model: string,
    private url: string,
    private apiKey: string,
    private nativeJson: boolean,
    private extraHeaders: Record<string, string> = {},
  ) {}
  async complete(r: CompletionRequest) {
    const data = await postJson(this.url, {
      model: this.model,
      messages: [{ role: 'system', content: r.system }, ...r.messages],
      temperature: r.temperature,
      max_tokens: r.maxTokens,
      response_format: r.json && this.nativeJson ? { type: 'json_object' } : undefined,
    }, { authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders }, r.signal);
    return String(data?.choices?.[0]?.message?.content ?? '');
  }
}

/** Anthropic Messages API. */
class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  constructor(readonly model: string, private apiKey: string) {}
  async complete(r: CompletionRequest) {
    const data = await postJson('https://api.anthropic.com/v1/messages', {
      model: this.model,
      max_tokens: r.maxTokens,
      temperature: r.temperature,
      system: r.system,
      messages: r.messages,
    }, { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, r.signal);
    return (data?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
}

function requireKey(provider: ProviderId, key: string) {
  if (!key) throw new Error(`LLM_PROVIDER=${provider} but its API key is not set in .env`);
  return key;
}

export function createProvider(id: ProviderId = config.provider): LLMProvider {
  const model = (fallback: string) => config.model || fallback;
  switch (id) {
    case 'ollama':
      return new OllamaProvider(model(config.ollama.model), config.ollama.baseUrl, config.ollama.numCtx);
    case 'gemini':
      return new GeminiProvider(model(config.gemini.model), requireKey(id, config.gemini.apiKey));
    case 'groq':
      return new OpenAICompatProvider('groq', model(config.groq.model), 'https://api.groq.com/openai/v1/chat/completions',
        requireKey(id, config.groq.apiKey), true);
    case 'openrouter':
      return new OpenAICompatProvider('openrouter', model(config.openrouter.model), 'https://openrouter.ai/api/v1/chat/completions',
        requireKey(id, config.openrouter.apiKey), false, { 'x-title': 'Warroom' });
    case 'anthropic':
      return new AnthropicProvider(model(config.anthropic.model), requireKey(id, config.anthropic.apiKey));
  }
}
