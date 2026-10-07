export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  /** Ask the provider for JSON output where it supports a native JSON mode. */
  json: boolean;
  signal: AbortSignal;
}

/** One implementation per provider. Providers only move text; validation happens in the service. */
export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<string>;
}

/** Thrown by providers on HTTP errors so the service can react to rate limits. */
export class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message);
  }
}

export async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    const ra = Number(res.headers.get('retry-after'));
    throw new ProviderError(`HTTP ${res.status}: ${text}`, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  return res.json() as Promise<any>;
}
