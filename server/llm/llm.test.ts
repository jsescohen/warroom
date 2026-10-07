import { describe, expect, it } from 'vitest';
import { extractJson } from './json';
import { RequestQueue, QueueRejected } from './queue';
import { LLMService } from './service';
import type { CompletionRequest, LLMProvider } from './types';

describe('extractJson', () => {
  it('parses plain, fenced, wrapped and sloppy JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go: {"a": {"b": "}"}} hope it helps')).toEqual({ a: { b: '}' } });
    expect(extractJson('<think>hmm {no}</think>{"a":[1,2,],}')).toEqual({ a: [1, 2] });
    expect(extractJson('no json here')).toBeUndefined();
  });
});

/** Scripted provider: returns the queued replies in order. */
class FakeProvider implements LLMProvider {
  readonly id = 'fake';
  readonly model = 'fake-1';
  calls: CompletionRequest[] = [];
  constructor(private replies: string[]) {}
  async complete(r: CompletionRequest) {
    this.calls.push(r);
    return this.replies.shift() ?? '';
  }
}

describe('LLMService', () => {
  it('returns validated data on the first good reply', async () => {
    const svc = new LLMService(new FakeProvider(['{"ok": true, "message": "Line open"}']));
    const r = await svc.runTask({ task: 'ping', system: 's', prompt: 'p' });
    expect(r).toMatchObject({ valid: true, attempts: 1, data: { ok: true, message: 'Line open' } });
  });

  it('retries once with a JSON reminder, then succeeds', async () => {
    const p = new FakeProvider(['I think everything is fine!', '{"ok": true, "message": "Fixed"}']);
    const r = await new LLMService(p).runTask({ task: 'ping', system: 's', prompt: 'p' });
    expect(r.valid).toBe(true);
    expect(r.attempts).toBe(2);
    expect(p.calls[1].messages.at(-1)?.content).toMatch(/ONLY one valid JSON/);
  });

  it('falls back to the safe default after two bad replies', async () => {
    const r = await new LLMService(new FakeProvider(['nope', '{"ok": "maybe"}'])).runTask({ task: 'ping', system: 's', prompt: 'p' });
    expect(r.valid).toBe(false);
    expect(r.data).toEqual({ ok: false, message: 'The model did not return valid JSON.' });
  });
});

describe('RequestQueue', () => {
  const opts = { minIntervalMs: 0, maxConcurrent: 1, actorCooldownMs: 60_000, maxQueuedAi: 1 };

  it('puts player requests ahead of AI requests', async () => {
    const q = new RequestQueue(opts);
    const order: string[] = [];
    const job = (name: string) => async () => { order.push(name); };
    let release!: () => void;
    const blocker = q.schedule(() => new Promise<void>((r) => (release = r)), 'player');
    const ai = q.schedule(job('ai'), 'ai', 'GER');
    const player = q.schedule(job('player'), 'player');
    release();
    await Promise.all([blocker, ai, player]);
    expect(order).toEqual(['player', 'ai']);
  });

  it('enforces per-actor cooldown for AI requests', async () => {
    const q = new RequestQueue(opts);
    await q.schedule(async () => 1, 'ai', 'ITA');
    await expect(q.schedule(async () => 2, 'ai', 'ITA')).rejects.toBeInstanceOf(QueueRejected);
    await expect(q.schedule(async () => 3, 'player', 'ITA')).resolves.toBe(3);
  });
});
