/**
 * All server configuration comes from environment variables (.env, loaded by `tsx --env-file`).
 * Switch AI providers by changing LLM_PROVIDER — no game code changes needed.
 */
export type ProviderId = 'ollama' | 'gemini' | 'groq' | 'openrouter' | 'anthropic';

const env = (k: string, d = '') => process.env[k]?.trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d;
};

const PROVIDERS: ProviderId[] = ['ollama', 'gemini', 'groq', 'openrouter', 'anthropic'];
const provider = env('LLM_PROVIDER', 'ollama').toLowerCase() as ProviderId;
if (!PROVIDERS.includes(provider)) throw new Error(`LLM_PROVIDER must be one of ${PROVIDERS.join(', ')} (got "${provider}")`);

/** Free tiers are rate limited; local Ollama is not. These are the per-provider defaults. */
const DEFAULT_MIN_INTERVAL: Record<ProviderId, number> = { ollama: 0, gemini: 4500, groq: 2200, openrouter: 3500, anthropic: 500 };

const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const betaCodes = env('BETA_CODES').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);

export const config = {
  production,
  /** Hosts (Render, Railway, Fly…) assign PORT; in development API_PORT avoids clashing with the web dev server. */
  port: production ? num('PORT', num('API_PORT', 8787)) : num('API_PORT', 8787),
  beta: {
    /** Comma-separated access codes. Empty = no gate (local development). */
    codes: betaCodes,
    /** Signs the unlock cookie. Defaults to a value derived from the codes. */
    secret: env('BETA_SECRET', `warroom:${betaCodes.join(',')}`),
  },
  provider,
  /** Generic override; otherwise the provider-specific *_MODEL variable is used. */
  model: env('LLM_MODEL'),
  timeoutMs: num('LLM_TIMEOUT_MS', provider === 'ollama' ? 90_000 : 45_000),
  /** Minimum gap between two requests to the provider. */
  minIntervalMs: num('LLM_MIN_INTERVAL_MS', DEFAULT_MIN_INTERVAL[provider]),
  /** Concurrent in-flight requests. Keep 1 for local models / free tiers. */
  maxConcurrent: num('LLM_MAX_CONCURRENT', 1),
  /** An AI nation can make at most one request per this window. */
  actorCooldownMs: num('LLM_ACTOR_COOLDOWN_MS', 45_000),
  /** Low-priority requests are rejected when this many are already waiting. */
  maxQueuedAi: num('LLM_MAX_QUEUED_AI', 4),

  ollama: {
    baseUrl: env('OLLAMA_BASE_URL', 'http://localhost:11434'),
    model: env('OLLAMA_MODEL', 'qwen2.5:7b'),
    /** Context window. Game prompts stay under ~2k tokens; a small window keeps the model in VRAM. */
    numCtx: num('OLLAMA_NUM_CTX', 4096),
  },
  gemini: { apiKey: env('GEMINI_API_KEY'), model: env('GEMINI_MODEL', 'gemini-2.5-flash') },
  groq: { apiKey: env('GROQ_API_KEY'), model: env('GROQ_MODEL', 'openai/gpt-oss-120b') },
  openrouter: { apiKey: env('OPENROUTER_API_KEY'), model: env('OPENROUTER_MODEL', 'meta-llama/llama-3.3-70b-instruct:free') },
  anthropic: { apiKey: env('ANTHROPIC_API_KEY'), model: env('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001') },
};
