import { tasks, type AiRequest, type AiResponse, type TaskId } from '../../shared/ai/tasks';
import { config } from '../config';
import { extractJson } from './json';
import { createProvider } from './providers';
import { RequestQueue } from './queue';
import { ProviderError, type ChatMessage, type LLMProvider } from './types';

const JSON_REMINDER =
  'Your previous reply was not valid JSON in the required format. Reply again with ONLY one valid JSON object: ' +
  'no prose, no code fences, no comments.';

/**
 * The single entry point for every AI call in the game. Runs a task through the configured
 * provider, validates the JSON against the task schema, retries once with a reminder, and
 * falls back to the task's safe default if the model still fails.
 */
export class LLMService {
  readonly queue: RequestQueue;

  constructor(readonly provider: LLMProvider = createProvider()) {
    this.queue = new RequestQueue({
      minIntervalMs: config.minIntervalMs,
      maxConcurrent: config.maxConcurrent,
      actorCooldownMs: config.actorCooldownMs,
      maxQueuedAi: config.maxQueuedAi,
    });
  }

  async runTask<T extends TaskId>(req: AiRequest<T>): Promise<AiResponse<T>> {
    const def = tasks[req.task];
    const started = Date.now();
    const priority = req.priority ?? 'player';
    const messages: ChatMessage[] = [{ role: 'user', content: req.prompt }];
    let attempts = 0;
    let lastError = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++;
      let text: string;
      const queuedAt = Date.now();
      let genStart = 0;
      try {
        // only the first attempt counts against the actor's cooldown
        text = await this.queue.schedule(() => {
          genStart = Date.now();
          return this.call(req.system, messages, def.maxTokens, def.temperature);
        }, priority, attempt === 0 ? req.actor : undefined);
      } catch (e) {
        const label = tag(req, attempt);
        if (e instanceof TimeoutError) {
          // a timeout means the model is overloaded: retrying would only double the load
          console.warn(`[llm] ${label} timed out after ${secs(Date.now() - (genStart || queuedAt))} (waited ${secs((genStart || Date.now()) - queuedAt)} in queue)`);
          throw e;
        }
        if (e instanceof ProviderError && e.status === 429) this.queue.pause(e.retryAfterMs ?? 15_000);
        if (attempt === 0 && !(e instanceof ProviderError && e.status >= 400 && e.status < 500 && e.status !== 429)) {
          lastError = String((e as Error).message ?? e);
          console.warn(`[llm] ${label} failed (${lastError}), retrying once`);
          continue; // network hiccup / 5xx / rate limit: one more try
        }
        console.warn(`[llm] ${label} failed: ${(e as Error).message}`);
        throw e;
      }
      const timing = `queue ${secs(genStart - queuedAt)} + model ${secs(Date.now() - genStart)}`;
      const parsed = def.schema.safeParse(extractJson(text));
      if (parsed.success) {
        console.log(`[llm] ${tag(req, attempt)} ok (${timing})`);
        return { data: parsed.data as AiResponse<T>['data'], valid: true, provider: this.provider.id, model: this.provider.model, attempts, ms: Date.now() - started };
      }
      lastError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      console.warn(`[llm] ${tag(req, attempt)} invalid JSON (${timing}): ${lastError}`);
      messages.push({ role: 'assistant', content: text.slice(0, 1500) || '(empty)' }, { role: 'user', content: `${JSON_REMINDER} Problems: ${lastError}` });
    }

    console.warn(`[llm] task "${req.task}" fell back after ${attempts} attempts: ${lastError}`);
    return { data: def.fallback as AiResponse<T>['data'], valid: false, provider: this.provider.id, model: this.provider.model, attempts, ms: Date.now() - started };
  }

  private async call(system: string, messages: ChatMessage[], maxTokens: number, temperature: number) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), config.timeoutMs);
    try {
      return await this.provider.complete({ system, messages, maxTokens, temperature, json: true, signal: ac.signal });
    } catch (e) {
      // aborting the request also makes Ollama stop generating, freeing the GPU
      if (ac.signal.aborted) throw new TimeoutError(`The AI took longer than ${Math.round(config.timeoutMs / 1000)}s to answer`);
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
}

export class TimeoutError extends Error {}

const secs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
const tag = (req: AiRequest, attempt: number) => `${req.task}${req.actor ? ` ${req.actor}` : ''} [${req.priority ?? 'player'}]${attempt ? ' retry' : ''}`;
